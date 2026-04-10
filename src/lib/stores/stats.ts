import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { cards, activeDeckId } from './data';
import { rangeToCutoff, computeCardCounts, computeIntervalBuckets, computeFutureDue, type StatsRange } from '../stats';

export interface ReviewStats {
  dailyCounts: { date: string; total: number; again: number; hard: number; good: number; easy: number }[];
  todayCount: number;
  todayAgain: number;
  todayCorrect: number;
}

export const statsRange = writable<StatsRange>('1m');
export const statsScope = writable<'deck' | 'all'>('deck');

export const filteredCards = derived(
  [cards, statsScope, activeDeckId],
  ([$cards, $scope, $deckId]) =>
    $scope === 'deck' && $deckId
      ? $cards.filter(c => c.deckId === $deckId)
      : $cards,
);

export const cardCounts = derived(filteredCards, $cards => computeCardCounts($cards));
export const intervalBuckets = derived(filteredCards, $cards => computeIntervalBuckets($cards));
export const futureDue = derived(filteredCards, $cards => computeFutureDue($cards, 30));

export const reviewStats = writable<ReviewStats | null>(null);

export async function fetchReviewStats(
  range: StatsRange,
  scope: 'deck' | 'all',
  deckId: string | null,
): Promise<void> {
  const since = rangeToCutoff(range);
  const did = scope === 'deck' ? deckId : undefined;
  try {
    const stats = await invoke<ReviewStats>('db_get_review_stats', {
      deckId: did ?? null,
      since: since ?? null,
    });
    reviewStats.set(stats);
  } catch (e) {
    console.error('[reki/stats] failed to fetch:', e);
    reviewStats.set(null);
  }
}
