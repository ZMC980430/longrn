import { Note } from './knowledge-builder.js';
import { EmbeddingEngine } from './embedding-engine.js';
import { NoteGenerator } from './note-generator.js';

const DEFAULT_SEMANTIC_THRESHOLD = 0.75;

/**
 * Two-layer auto-linker that combines exact and semantic matching.
 *
 * **Layer 1 — Exact match**: replaces bare note titles with `[[wikilinks]]`
 * using a longest-match-first strategy (reuses NoteGenerator.autoLink).
 *
 * **Layer 2 — Semantic fuzzy match**: splits content into paragraphs,
 * embeds each via EmbeddingEngine, and appends `> 相关：[[Title]]` suggestions
 * when cosine similarity exceeds a configurable threshold.
 *
 * **Cross-linking** (`crossLinkBatch`): computes pairwise semantic similarity
 * among a batch of notes and injects bidirectional `[[wikilinks]]`.
 */
export class SemanticAutoLinker {
  private noteGenerator: NoteGenerator;

  constructor() {
    this.noteGenerator = new NoteGenerator();
  }

  /**
   * 两层自动链接：
   * 1. 精确匹配（最长匹配优先）
   * 2. 语义模糊匹配（通过嵌入相似度），在段落末尾追加建议链接
   */
  async semanticAutoLink(
    content: string,
    kb: Map<string, Note>,
    engine: EmbeddingEngine,
    threshold: number = DEFAULT_SEMANTIC_THRESHOLD,
  ): Promise<string> {
    // Layer 1: exact match (existing)
    let processed = content;
    const titles = Array.from(kb.values()).map(n => n.title).sort((a, b) => b.length - a.length);
    const matchedTitles = new Set<string>();

    for (const title of titles) {
      const regex = new RegExp(`(?<!\\[\\[)${this.escapeRegExp(title)}(?!\\]\\])`, 'g');
      if (regex.test(processed)) {
        processed = processed.replace(regex, `[[${title}]]`);
        matchedTitles.add(title);
      }
    }

    // Layer 2: semantic fuzzy match for unmapped paragraphs
    const paragraphs = this.splitParagraphs(processed);
    const enrichedParagraphs: string[] = [];

    for (const para of paragraphs) {
      const stripped = para.replace(/\[\[([^\]]+)\]\]/g, '$1'); // unwrap existing links
      const paraEmb = await engine.embed(stripped.slice(0, 500));

      // Find best matching titles not already linked
      const candidates: { title: string; score: number }[] = [];
      for (const note of kb.values()) {
        if (matchedTitles.has(note.title)) continue;
        if (!note.embeddings) continue;
        const score = EmbeddingEngine.cosineSimilarity(paraEmb, note.embeddings);
        if (score >= threshold) {
          candidates.push({ title: note.title, score });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const topCandidates = candidates.slice(0, 3);

      let enriched = para;
      if (topCandidates.length > 0) {
        // Only append if the paragraph doesn't already have these links
        const alreadyLinked = [...matchedTitles];
        const newLinks = topCandidates.filter(c => !alreadyLinked.includes(c.title));
        if (newLinks.length > 0) {
          enriched += `\n\n> 相关：${newLinks.map(c => `[[${c.title}]]`).join(' ')}`;
          newLinks.forEach(c => matchedTitles.add(c.title));
        }
      }
      enrichedParagraphs.push(enriched);
    }

    return enrichedParagraphs.join('\n\n');
  }

  /**
   * 批量增强跨笔记互联：
   * 对一组笔记两两计算语义相似度，自动建立双向链接
   */
  async crossLinkBatch(
    notes: Note[],
    engine: EmbeddingEngine,
    threshold: number = DEFAULT_SEMANTIC_THRESHOLD,
  ): Promise<Note[]> {
    const embeddings = await Promise.all(
      notes.map(n => engine.embed(`${n.title}\n${n.content.slice(0, 300)}`)),
    );

    const enriched: Note[] = notes.map(n => ({ ...n }));

    for (let i = 0; i < notes.length; i++) {
      const existingLinks = new Set(enriched[i].links);
      const newLinks: string[] = [];

      for (let j = 0; j < notes.length; j++) {
        if (i === j) continue;
        const score = EmbeddingEngine.cosineSimilarity(embeddings[i], embeddings[j]);
        if (score >= threshold) {
          if (!existingLinks.has(notes[j].title)) {
            newLinks.push(notes[j].title);
          }
        }
      }

      if (newLinks.length > 0) {
        enriched[i] = {
          ...enriched[i],
          links: [...enriched[i].links, ...newLinks],
          content: enriched[i].content + `\n\n相关：${newLinks.map(t => `[[${t}]]`).join(' ')}`,
        };
      }
    }

    return enriched;
  }

  private splitParagraphs(content: string): string[] {
    return content
      .split(/\n\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
