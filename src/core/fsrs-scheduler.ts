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
  stability: number;    // 记忆稳定性（天数）
  easeFactor: number;   // 难度因子 [1.3, 10]
  reviewCount: number;  // 累计复习次数
}

export interface ScheduledResult extends CardState {
  intervalDays: number; // 下次复习间隔（天数）
}

const RETENTION = 0.9;

export class FSRSScheduler {
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
      intervalDays = Math.min(intervalDays, 1);   // Again: within 1 day
    } else if (rating === 2) {
      intervalDays = Math.max(intervalDays * 0.5, 0.1); // Hard: half the interval
    }

    // Clamp
    intervalDays = Math.max(0.01, Math.min(365, intervalDays));
    newEaseFactor = Math.max(1.3, Math.min(10, newEaseFactor));

    return {
      stability: newStability,
      easeFactor: newEaseFactor,
      reviewCount: newReviewCount,
      intervalDays,
    };
  }

  /** 首次复习初始稳定性 */
  private initialStability(rating: 1 | 2 | 3 | 4): number {
    const map: Record<number, number> = { 1: 0.1, 2: 0.5, 3: 1.0, 4: 3.0 };
    return map[rating];
  }

  /** 首次复习初始难度因子 */
  private initialEaseFactor(rating: 1 | 2 | 3 | 4): number {
    const base = 2.5;
    const map: Record<number, number> = { 1: base + 0.5, 2: base + 0.2, 3: base, 4: base - 0.3 };
    return Math.max(1.3, Math.min(10, map[rating]));
  }

  /**
   * 后续复习稳定性: S' = S * (1 + 0.15 * EF^0.8) * rf
   * 其中 rf 是评分因子: Again=0.4, Hard=0.6, Good=1.3, Easy=2.5
   */
  private nextStability(rating: 1 | 2 | 3 | 4, stability: number, easeFactor: number): number {
    const rf: Record<number, number> = { 1: 0.4, 2: 0.6, 3: 1.3, 4: 2.5 };
    const growth = 1 + 0.15 * Math.pow(easeFactor, 0.8);
    return Math.max(0.01, stability * growth * rf[rating]);
  }

  /**
   * 后续复习难度因子: EF' = EF + 0.3 * (3 - rating)
   * Again(r=1): EF += 0.6  (更困难)
   * Hard(r=2): EF += 0.3
   * Good(r=3): EF unchanged
   * Easy(r=4): EF -= 0.3  (更简单)
   */
  private nextEaseFactor(rating: 1 | 2 | 3 | 4, currentEase: number): number {
    return currentEase + 0.3 * (3 - rating);
  }

  /**
   * 计算间隔: I = S * ln(R) / ln(0.5)
   * 当 R=0.9 时, ln(0.9)/ln(0.5) ≈ 0.152
   */
  private calculateInterval(stability: number, retention: number): number {
    return stability * Math.log(retention) / Math.log(0.5);
  }

  /**
   * 给定稳定性和经过天数，计算记忆保留率 R = 0.5^(t/S)
   */
  getRetention(stability: number, elapsedDays: number): number {
    if (stability <= 0) return 0;
    return Math.pow(0.5, elapsedDays / stability);
  }

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
