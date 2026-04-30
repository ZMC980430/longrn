import * as fs from 'fs';
import * as path from 'path';
import { FSRSScheduler, CardState } from './fsrs-scheduler.js';

/**
 * Pluggable file I/O adapter for LearningStateManager.
 * Allows Obsidian plugin to inject vault API wrappers instead of Node.js `fs`.
 * All methods allow both sync (`fs`) and async (Obsidian vault) return types.
 */
export interface StateFileOps {
  exists(filePath: string): boolean | Promise<boolean>;
  mkdir(dirPath: string): void | Promise<void>;
  readFile(filePath: string): string | Promise<string>;
  writeFile(filePath: string, data: string): void | Promise<void>;
}

/**
 * Learning status for a knowledge node.
 * - unknown:     Not yet encountered
 * - planned:     Added to a learning path
 * - in_progress: Currently being studied
 * - mastered:    Reviewed successfully (rating >= 3)
 * - archived:    Long unreviewed — may need re-learning
 */
export type LearningStatus = 'unknown' | 'planned' | 'in_progress' | 'mastered' | 'archived';

/** Persisted state for a single knowledge node. */
export interface LearningState {
  noteId: string;
  status: LearningStatus;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewCount: number;
  easeFactor: number;
  stability: number;
}

/** Persisted state index — stored as JSON at `.longrn/state.json`. */
export interface StateIndex {
  updatedAt: string;
  entries: Record<string, LearningState>;
}

/** Default file ops using Node.js `fs` (sync). */
export const defaultFileOps: StateFileOps = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => { fs.mkdirSync(p, { recursive: true }); },
  readFile: (p) => fs.readFileSync(p, 'utf-8'),
  writeFile: (p, d) => { fs.writeFileSync(p, d); },
};

/**
 * Manages learning states for all knowledge graph nodes.
 *
 * Features:
 * - Five-state lifecycle (unknown → planned → in_progress → mastered → archived)
 * - Automatic persistence to `<vaultPath>/.longrn/state.json`
 * - Integration with FSRSScheduler for spaced repetition review scheduling
 * - Batch queries: getMasteredIds, getPlannedIds, getStaleIds, getDueIds
 */
export class LearningStateManager {
  private statePath: string;
  public index: StateIndex;
  private scheduler: FSRSScheduler;
  private fileOps: StateFileOps;

  /**
   * @param vaultPath - Vault root path; state file stored at `.longrn/state.json`
   * @param fileOps - Optional file ops adapter (default: Node.js `fs`)
   */
  constructor(vaultPath: string, fileOps?: StateFileOps) {
    this.fileOps = fileOps ?? defaultFileOps;
    const storeDir = path.join(vaultPath, '.longrn');
    // Use sync check for dir; the rest is async-capable
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    this.statePath = path.join(storeDir, 'state.json');
    this.index = { updatedAt: '', entries: {} };
    this.scheduler = new FSRSScheduler();
    // Try loading existing state (silent fail if not found)
    this.loadState().catch(() => {});
  }

  /** Loads persisted states from disk. Returns false if no state file exists. */
  async loadState(): Promise<boolean> {
    try {
      const exists = await this.fileOps.exists(this.statePath);
      if (!exists) return false;
      const raw = await this.fileOps.readFile(this.statePath);
      this.index = JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  /** Persists the current state index to disk. */
  async saveState(): Promise<void> {
    this.index.updatedAt = new Date().toISOString();
    await this.fileOps.writeFile(this.statePath, JSON.stringify(this.index, null, 2));
  }

  /** Ensures a state entry exists for the given note ID, creating it if absent. */
  private ensureEntry(noteId: string): LearningState {
    if (!this.index.entries[noteId]) {
      this.index.entries[noteId] = {
        noteId,
        status: 'unknown',
        reviewCount: 0,
        easeFactor: 2.5,
        stability: 0,
      };
    }
    return this.index.entries[noteId];
  }

  /** Sets the learning status for a node. */
  async setStatus(noteId: string, status: LearningStatus): Promise<void> {
    const entry = this.ensureEntry(noteId);
    entry.status = status;
    if (status === 'in_progress' || status === 'mastered') {
      entry.lastReviewedAt = new Date().toISOString();
    }
    await this.saveState();
  }

  /** Returns the current learning status of a node (defaults to 'unknown'). */
  getStatus(noteId: string): LearningStatus {
    return this.index.entries[noteId]?.status ?? 'unknown';
  }

  /** Returns a Set of note IDs with status 'mastered' or 'archived'. */
  getMasteredIds(): Set<string> {
    return new Set(
      Object.entries(this.index.entries)
        .filter(([_, s]) => s.status === 'mastered' || s.status === 'archived')
        .map(([id]) => id),
    );
  }

  /** Returns a Set of note IDs with status 'planned' or 'in_progress'. */
  getPlannedIds(): Set<string> {
    return new Set(
      Object.entries(this.index.entries)
        .filter(([_, s]) => s.status === 'planned' || s.status === 'in_progress')
        .map(([id]) => id),
    );
  }

  /**
   * Returns IDs of nodes whose nextReviewAt is older than `days` ago.
   * Useful for identifying nodes that are overdue for review.
   */
  getStaleIds(days: number): string[] {
    const cutoff = Date.now() - days * 86400_000;
    return Object.entries(this.index.entries)
      .filter(([_, s]) => {
        if (!s.nextReviewAt) return false;
        return new Date(s.nextReviewAt).getTime() < cutoff;
      })
      .map(([id]) => id);
  }

  /**
   * Records a review rating for a note and updates FSRS scheduling.
   * @param rating - 1=Again 2=Hard 3=Good 4=Easy
   * @returns The updated CardState from the FSRS scheduler
   */
  async recordReview(noteId: string, rating: 1 | 2 | 3 | 4): Promise<CardState> {
    const entry = this.ensureEntry(noteId);
    const current: CardState = {
      stability: entry.stability,
      easeFactor: entry.easeFactor,
      reviewCount: entry.reviewCount,
    };
    const next = this.scheduler.schedule(rating, current);

    entry.stability = next.stability;
    entry.easeFactor = next.easeFactor;
    entry.reviewCount = next.reviewCount;
    entry.lastReviewedAt = new Date().toISOString();

    const intervalMs = next.intervalDays * 86400_000;
    entry.nextReviewAt = new Date(Date.now() + intervalMs).toISOString();

    if (rating >= 3) {
      entry.status = 'mastered';
    } else if (entry.status === 'unknown') {
      entry.status = 'in_progress';
    }

    await this.saveState();
    return next;
  }

  /** Returns IDs of nodes whose nextReviewAt is due (now or in the past). */
  getDueIds(): string[] {
    const now = Date.now();
    return Object.entries(this.index.entries)
      .filter(([_, s]) => {
        if (!s.nextReviewAt) return false;
        return new Date(s.nextReviewAt).getTime() <= now;
      })
      .map(([id]) => id);
  }

  /** Returns aggregate review statistics. */
  getReviewStats(): { total: number; mastered: number; planned: number; inProgress: number; archived: number } {
    const stats = { total: 0, mastered: 0, planned: 0, inProgress: 0, archived: 0 };
    for (const s of Object.values(this.index.entries)) {
      stats.total++;
      switch (s.status) {
        case 'mastered': stats.mastered++; break;
        case 'planned': stats.planned++; break;
        case 'in_progress': stats.inProgress++; break;
        case 'archived': stats.archived++; break;
      }
    }
    return stats;
  }

  /** Returns all state entries (read-only snapshot). */
  getAllStates(): Record<string, LearningState> {
    return this.index.entries;
  }
}
