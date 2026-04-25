import * as fs from 'fs';
import * as path from 'path';
import { FSRSScheduler, CardState } from './fsrs-scheduler.js';

export type LearningStatus = 'unknown' | 'planned' | 'in_progress' | 'mastered' | 'archived';

export interface LearningState {
  noteId: string;
  status: LearningStatus;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewCount: number;
  easeFactor: number;
  stability: number;
}

export interface StateIndex {
  updatedAt: string;
  entries: Record<string, LearningState>;
}

export class LearningStateManager {
  private statePath: string;
  public index: StateIndex;
  private scheduler: FSRSScheduler;

  constructor(vaultPath: string) {
    const storeDir = path.join(vaultPath, '.longrn');
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    this.statePath = path.join(storeDir, 'state.json');
    this.index = { updatedAt: '', entries: {} };
    this.scheduler = new FSRSScheduler();
    this.loadState();
  }

  loadState(): boolean {
    try {
      if (!fs.existsSync(this.statePath)) return false;
      const raw = fs.readFileSync(this.statePath, 'utf-8');
      this.index = JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  saveState(): void {
    this.index.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.index, null, 2));
  }

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

  setStatus(noteId: string, status: LearningStatus): void {
    const entry = this.ensureEntry(noteId);
    entry.status = status;
    if (status === 'in_progress' || status === 'mastered') {
      entry.lastReviewedAt = new Date().toISOString();
    }
    this.saveState();
  }

  getStatus(noteId: string): LearningStatus {
    return this.index.entries[noteId]?.status ?? 'unknown';
  }

  getMasteredIds(): Set<string> {
    return new Set(
      Object.entries(this.index.entries)
        .filter(([_, s]) => s.status === 'mastered' || s.status === 'archived')
        .map(([id]) => id),
    );
  }

  getPlannedIds(): Set<string> {
    return new Set(
      Object.entries(this.index.entries)
        .filter(([_, s]) => s.status === 'planned' || s.status === 'in_progress')
        .map(([id]) => id),
    );
  }

  getStaleIds(days: number): string[] {
    const cutoff = Date.now() - days * 86400_000;
    return Object.entries(this.index.entries)
      .filter(([_, s]) => {
        if (!s.nextReviewAt) return false;
        return new Date(s.nextReviewAt).getTime() < cutoff;
      })
      .map(([id]) => id);
  }

  recordReview(noteId: string, rating: 1 | 2 | 3 | 4): CardState {
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

    // Next review = now + interval days
    const intervalMs = next.intervalDays * 86400_000;
    entry.nextReviewAt = new Date(Date.now() + intervalMs).toISOString();

    if (rating >= 3) {
      entry.status = 'mastered';
    } else if (entry.status === 'unknown') {
      entry.status = 'in_progress';
    }

    this.saveState();
    return next;
  }

  getDueIds(): string[] {
    const now = Date.now();
    return Object.entries(this.index.entries)
      .filter(([_, s]) => {
        if (!s.nextReviewAt) return false;
        return new Date(s.nextReviewAt).getTime() <= now;
      })
      .map(([id]) => id);
  }

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

  getAllStates(): Record<string, LearningState> {
    return this.index.entries;
  }
}
