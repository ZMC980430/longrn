import * as fs from 'fs';
import * as path from 'path';
import { Note } from './knowledge-builder.js';

/**
 * Generates structured Markdown notes and auto-links them.
 *
 * Two linking strategies:
 * 1. **Exact match** (`autoLink`): longest-title-first regex replacement.
 * 2. **Batch generation** (`generateNotes`): creates numbered note files
 *    under a `learning-path/` subfolder.
 */
export class NoteGenerator {
  /**
   * Renders a note using a Mustache-like template.
   * Available placeholders: ${title}, ${content}, ${links}.
   *
   * @param step - The note data to render
   * @param template - Optional custom template; defaults to:
   *   `# ${title}\n\n${content}\n\n相关：${links}`
   */
  generateNote(step: Note, template: string = '# ${title}\n\n${content}\n\n相关：${links}'): string {
    return template
      .replace('${title}', step.title)
      .replace('${content}', step.content)
      .replace('${links}', step.links.map(l => `[[${l}]]`).join(' '));
  }

  /**
   * Auto-links content by replacing bare note titles with [[wikilinks]].
   * Uses longest-match-first to avoid partial replacements
   * (e.g. "TypeScript" won't break "TypeScript Handbook").
   */
  autoLink(content: string, knowledgeBase: Map<string, Note>): string {
    let processedContent = content;
    const titles = Array.from(knowledgeBase.values()).map(n => n.title).sort((a, b) => b.length - a.length);

    for (const title of titles) {
      const regex = new RegExp(`(?<!\\[\\[)${this.escapeRegExp(title)}(?!\\]\\])`, 'g');
      if (regex.test(processedContent)) {
        processedContent = processedContent.replace(regex, `[[${title}]]`);
      }
    }

    return processedContent;
  }

  /** Escapes special regex characters in a string. */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Batch-generates note files for a learning path.
   * Files are created under `<vaultPath>/learning-path/` and numbered.
   * Each note is auto-linked against all other notes in the path.
   */
  async generateNotes(pathSteps: Note[], vaultPath: string, template?: string): Promise<void> {
    const outputDir = path.join(vaultPath, 'learning-path');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (let i = 0; i < pathSteps.length; i++) {
      const step = pathSteps[i];
      let content = this.generateNote(step, template);
      content = this.autoLink(content, new Map(pathSteps.map(n => [n.title, n])));

      const fileName = `${i + 1}-${step.title.replace(/[^a-zA-Z0-9]/g, '-')}.md`;
      fs.writeFileSync(path.join(outputDir, fileName), content);
    }
  }
}