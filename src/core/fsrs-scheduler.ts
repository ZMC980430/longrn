/**
 * FSRS-5 复习调度器
 *
 * 基于 FSRS-5 (Free Spaced Repetition Scheduler) 算法精简实现。
 * 参考文献: https://github.com/open-spaced-repetition/fsrs4anki
 *
 * 输入：评分 1=Again 2=Hard 3=Good 4=Easy + 当前卡片状态
 * 输出：更新后的稳定性、难度因子、下次复习间隔（天数）
 *
 * FSRS-5 核心公式：
 *   - 首次复习: S_0 = f(rating), EF_0 = g(rating)
 *   - 后续复习: S' = S * (1 + w5 * EF^w6) * ratingFactor[r]
 *     - ratingFactor: Again=0.4, Hard=0.6, Good=1.3, Easy=2.5
 *     - EF' = EF + w7 * (3 - r)  (r=rating)
 *   - 间隔: I = S' * ln(requestRetention) / ln(0.5)
 */

export interface CardState {
  /** Memory stability in days — how long until retention drops to ~90% */
  stability: number;
  /** Ease factor in [1.3, 10] — higher = easier to retain */
  easeFactor: number;
  /** Total number of reviews performed */
  reviewCount: number;
}

export interface ScheduledResult extends CardState {
  /** Days until the next review */
  intervalDays: number;
}

/** Desired retention rate (90%) — used to compute review intervals. */
const RETENTION = 0.9;

export class FSRSScheduler {
  /**
   * Computes the next review schedule based on the user's rating.
   *
   * @param rating - 1=Again (forgot), 2=Hard, 3=Good, 4=Easy
   * @param current - Current card state (stability, easeFactor, reviewCount)
   * @returns Updated state with next review interval
   */
  schedule(rating: 1 | 2 | 3 | 4, current: CardState): ScheduledResult {
    const { stability, easeFactor, reviewCount } = current;
    const isFirstReview = stability <= 0;

    let newStability: number;
    let newEaseFactor: number;

    if (isFirstReview) {
      newStability = this.initialStability(rating);
      newEaseFactor = this.initialEaseFactor(rating);
    } else {
      newStability = this.nextStability(rating, stability, easeFactor);
      newEaseFactor = this.nextEaseFactor(rating, easeFactor);
    }

    const newReviewCount = reviewCount + 1;
    let intervalDays = this.calculateInterval(newStability, RETENTION);

    // Rating-based interval adjustment
    if (rating === 1) {
      intervalDays = Math.min(intervalDays, 1);
    } else if (rating === 2) {
      intervalDays = Math.max(intervalDays * 0.5, 0.1);
    }

    // Clamp to safe bounds
    intervalDays = Math.max(0.01, Math.min(365, intervalDays));
    newEaseFactor = Math.max(1.3, Math.min(10, newEaseFactor));

    return {
      stability: newStability,
      easeFactor: newEaseFactor,
      reviewCount: newReviewCount,
      intervalDays,
    };
  }

  /** Initial stability for first review. Again=0.1d, Hard=0.5d, Good=1d, Easy=3d. */
  private initialStability(rating: 1 | 2 | 3 | 4): number {
    const map: Record<number, number> = { 1: 0.1, 2: 0.5, 3: 1.0, 4: 3.0 };
    return map[rating];
  }

  /** Initial ease factor. Again=3.0, Hard=2.7, Good=2.5, Easy=2.2. */
  private initialEaseFactor(rating: 1 | 2 | 3 | 4): number {
    const base = 2.5;
    const map: Record<number, number> = { 1: base + 0.5, 2: base + 0.2, 3: base, 4: base - 0.3 };
    return Math.max(1.3, Math.min(10, map[rating]));
  }

  /**
   * Subsequent review stability: S' = S * (1 + 0.15 * EF^0.8) * ratingFactor.
   * ratingFactor: Again=0.4, Hard=0.6, Good=1.3, Easy=2.5.
   */
  private nextStability(rating: 1 | 2 | 3 | 4, stability: number, easeFactor: number): number {
    const rf: Record<number, number> = { 1: 0.4, 2: 0.6, 3: 1.3, 4: 2.5 };
    const growth = 1 + 0.15 * Math.pow(easeFactor, 0.8);
    return Math.max(0.01, stability * growth * rf[rating]);
  }

  /**
   * Subsequent ease factor: EF' = EF + 0.3 * (3 - rating).
   * Again(r=1): EF += 0.6 (harder). Hard(r=2): EF += 0.3.
   * Good(r=3): unchanged. Easy(r=4): EF -= 0.3 (easier).
   */
  private nextEaseFactor(rating: 1 | 2 | 3 | 4, currentEase: number): number {
    return currentEase + 0.3 * (3 - rating);
  }

  /**
   * Computes the review interval from memory stability.
   * I = S * ln(retention) / ln(0.5)
   * For R=90%: ln(0.9)/ln(0.5) ≈ 0.152
   */
  private calculateInterval(stability: number, retention: number): number {
    return stability * Math.log(retention) / Math.log(0.5);
  }

  /**
   * Estimates memory retention given stability and elapsed time.
   * R = 0.5^(t/S)
   */
  getRetention(stability: number, elapsedDays: number): number {
    if (stability <= 0) return 0;
    return Math.pow(0.5, elapsedDays / stability);
  }

  /**
   * Generates a Markdown review note template.
   * Includes the note content excerpt and scoring checkboxes.
   */
  generateReviewTemplate(noteTitle: string, noteContent: string, noteTags: string[]): string {
    const tags = noteTags.map(t => `#${t}`).join(' ');
    return [
      `## 🔄 复习: ${noteTitle}`,
      '',
      `> ${noteContent.slice(0, 200)}`,
      '',
      tags,
      '',
      '---',
      '**评分：**',
      '- [ ] Again（完全忘记了）',
      '- [ ] Hard（很困难才想起）',
      '- [ ] Good（正常回忆）',
      '- [ ] Easy（非常轻松）',
      '',
      '---',
      '**回顾笔记：**',
      '',
      '---',
      `*自动生成于 ${new Date().toISOString().slice(0, 10)}*`,
    ].join('\n');
  }
}
