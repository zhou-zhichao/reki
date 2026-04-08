import { writable } from 'svelte/store';

export type RatingKey = 'again' | 'hard' | 'good' | 'easy';

export type RatingShortcuts = Record<RatingKey, string>;

const DEFAULT_SHORTCUTS: RatingShortcuts = {
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
};

const STORAGE_KEY = 'reki-rating-shortcuts';

function load(): RatingShortcuts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<RatingShortcuts>;
    return { ...DEFAULT_SHORTCUTS, ...parsed };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function createShortcutsStore() {
  const { subscribe, set, update } = writable<RatingShortcuts>(load());

  return {
    subscribe,
    setKey(rating: RatingKey, key: string) {
      update(s => {
        const next = { ...s, [rating]: key };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    reset() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SHORTCUTS));
      set({ ...DEFAULT_SHORTCUTS });
    },
  };
}

export const shortcuts = createShortcutsStore();

/** Pretty label for a key (uppercase letters, named keys preserved) */
export function formatKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  // Named keys: Space, Enter, ArrowLeft, etc.
  return key;
}
