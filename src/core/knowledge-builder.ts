import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
        // For simplicity, create edges to other notes with same tag
        notes.forEach(other => {
          if (other.id !== note.id && other.tags.includes(tag)) {
            edges.set(`${note.id}-${other.id}-tag`, { from: note.id, to: other.id, type: 'tag' });
          }
        });
      });
    });

    return { nodes, edges };
  }

  // Placeholder for embeddings
  generateEmbeddings(notes: Note[]): void {
    // In real implementation, use a model like sentence-transformers
    notes.forEach(note => {
      note.embeddings = [Math.random(), Math.random()]; // Dummy
    });
  }
}