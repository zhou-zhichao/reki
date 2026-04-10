import { describe, it, expect } from 'vitest';
import { rangeToCutoff, computeCardCounts, computeIntervalBuckets, computeFutureDue } from './stats';
import type { Card } from './stores/data';

const DAY = 86_400_000;

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: '1', deckId: 'd1', noteId: 'n1', ordinal: 0,
    front: '', back: '',
    stability: null, difficulty: null, lastReview: null,
    interval: 0, due: Date.now(), reps: 0, lapses: 0,
    state: 'new', ease: 2.5, tags: [], createdAt: 0, editedAt: 0, flag: 0, position: 0,
    ...overrides,
  };
}

describe('rangeToCutoff', () => {
  it('returns null for all', () => {
    expect(rangeToCutoff('all')).toBeNull();
  });

  it('returns epoch ms for 1m', () => {
    const cutoff = rangeToCutoff('1m')!;
    const expected = Date.now() - 30 * DAY;
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000);
  });

  it('returns epoch ms for 3m', () => {
    const cutoff = rangeToCutoff('3m')!;
    const expected = Date.now() - 90 * DAY;
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000);
  });

  it('returns epoch ms for 1y', () => {
    const cutoff = rangeToCutoff('1y')!;
    const expected = Date.now() - 365 * DAY;
    expect(Math.abs(cutoff - expected)).toBeLessThan(1000);
  });
});

describe('computeCardCounts', () => {
  it('counts card states', () => {
    const cards = [
      makeCard({ state: 'new' }),
      makeCard({ state: 'learning' }),
      makeCard({ state: 'review', interval: 10 }),
      makeCard({ state: 'review', interval: 30 }),
      makeCard({ state: 'suspended' }),
    ];
    const result = computeCardCounts(cards);
    expect(result.new).toBe(1);
    expect(result.learning).toBe(1);
    expect(result.young).toBe(1);
    expect(result.mature).toBe(1);
    expect(result.suspended).toBe(1);
  });
});

describe('computeIntervalBuckets', () => {
  it('groups cards by interval', () => {
    const cards = [
      makeCard({ state: 'review', interval: 1 }),
      makeCard({ state: 'review', interval: 5 }),
      makeCard({ state: 'review', interval: 15 }),
      makeCard({ state: 'review', interval: 60 }),
      makeCard({ state: 'new', interval: 0 }),
    ];
    const buckets = computeIntervalBuckets(cards);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(4);
  });
});

describe('computeFutureDue', () => {
  it('groups cards by days until due', () => {
    const now = Date.now();
    const cards = [
      makeCard({ due: now, interval: 5, state: 'review' }),
      makeCard({ due: now + DAY, interval: 25, state: 'review' }),
      makeCard({ due: now + 2 * DAY, interval: 10, state: 'review' }),
    ];
    const result = computeFutureDue(cards, 30);
    expect(result[0].young + result[0].mature).toBe(1);
    expect(result[1].mature).toBe(1);
    expect(result[2].young).toBe(1);
  });
});
