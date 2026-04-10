/**
 * Pure functions for deriving statistics from card data.
 * No side effects, no store access — takes data in, returns computed stats.
 */

import type { Card } from './stores/data';

export type StatsRange = '1m' | '3m' | '1y' | 'all';

const DAY = 86_400_000;

export function rangeToCutoff(range: StatsRange): number | null {
  switch (range) {
    case '1m': return Date.now() - 30 * DAY;
    case '3m': return Date.now() - 90 * DAY;
    case '1y': return Date.now() - 365 * DAY;
    case 'all': return null;
  }
}

export interface CardCounts {
  new: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
  total: number;
}

export function computeCardCounts(cards: Card[]): CardCounts {
  const counts: CardCounts = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0, total: cards.length };
  for (const c of cards) {
    switch (c.state) {
      case 'new': counts.new++; break;
      case 'learning': counts.learning++; break;
      case 'review':
        if (c.interval >= 21) counts.mature++;
        else counts.young++;
        break;
      case 'suspended':
      case 'buried':
        counts.suspended++;
        break;
    }
  }
  return counts;
}

export interface IntervalBucket {
  label: string;
  count: number;
}

const INTERVAL_RANGES: [number, number, string][] = [
  [0, 1, '0-1d'],
  [2, 3, '2-3d'],
  [4, 7, '4-7d'],
  [8, 14, '1-2w'],
  [15, 30, '2-4w'],
  [31, 60, '1-2mo'],
  [61, 90, '2-3mo'],
  [91, 180, '3-6mo'],
  [181, 365, '6-12mo'],
  [366, Infinity, '1y+'],
];

export function computeIntervalBuckets(cards: Card[]): IntervalBucket[] {
  const buckets = INTERVAL_RANGES.map(([,, label]) => ({ label, count: 0 }));
  for (const c of cards) {
    if (c.state === 'new' || c.interval <= 0) continue;
    const idx = INTERVAL_RANGES.findIndex(([min, max]) => c.interval >= min && c.interval <= max);
    if (idx >= 0) buckets[idx].count++;
  }
  return buckets;
}

export interface FutureDueDay {
  day: number;
  young: number;
  mature: number;
}

export function computeFutureDue(cards: Card[], days: number = 30): FutureDueDay[] {
  const now = Date.now();
  const result: FutureDueDay[] = Array.from({ length: days }, (_, i) => ({
    day: i, young: 0, mature: 0,
  }));

  for (const c of cards) {
    if (c.state === 'new' || c.state === 'suspended' || c.state === 'buried') continue;
    const daysUntil = Math.floor((c.due - now) / DAY);
    if (daysUntil < 0 || daysUntil >= days) continue;
    if (c.interval >= 21) result[daysUntil].mature++;
    else result[daysUntil].young++;
  }

  return result;
}
