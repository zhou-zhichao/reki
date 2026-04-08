import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;

  // FSRS scheduling state (managed by Rust backend)
  stability: number | null;
  difficulty: number | null;
  lastReview: number | null;

  // Display
  interval: number;
  due: number;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'suspended' | 'buried';

  // Legacy compat for query language `prop:ease`
  ease: number;

  tags: string[];
  createdAt: number;
  editedAt: number;
  flag: number;
  position: number;
}

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
}

interface Snapshot {
  decks: Deck[];
  cards: Card[];
}

// ──────────────────────────────────────────────────────────────
// Stores
// ──────────────────────────────────────────────────────────────

export const decks = writable<Deck[]>([]);
export const cards = writable<Card[]>([]);
export const activeDeckId = writable<string | null>(null);
export const dataLoaded = writable<boolean>(false);

export const activeDeck = derived([decks, activeDeckId], ([$decks, $id]) =>
  $decks.find(d => d.id === $id) ?? null
);

export const dueCards = derived([cards, activeDeckId], ([$cards, $id]) =>
  $cards.filter(c => c.deckId === $id && c.due <= Date.now())
);

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function persist<T>(promise: Promise<T>): void {
  promise.catch(e => console.error('[reki/db]', e));
}

// ──────────────────────────────────────────────────────────────
// Init / load
// ──────────────────────────────────────────────────────────────

/** Load decks and cards from SQLite. Seeds demo data on first run. */
export async function loadFromDb(): Promise<void> {
  try {
    const snap = await invoke<Snapshot>('db_load_all');
    if (snap.decks.length === 0 && snap.cards.length === 0) {
      const seed = buildDemoData();
      decks.set(seed.decks);
      cards.set(seed.cards);
      // Persist the seed so the user can see the same state next launch.
      for (const d of seed.decks) {
        await invoke('db_save_deck', { deck: d });
      }
      await invoke('db_save_cards_bulk', { cards: seed.cards });
    } else {
      decks.set(snap.decks);
      cards.set(snap.cards);
    }
    dataLoaded.set(true);
  } catch (e) {
    console.error('[reki/db] failed to load:', e);
    dataLoaded.set(true); // unblock the UI even on error
  }
}

// ──────────────────────────────────────────────────────────────
// Mutations (optimistic update + fire-and-forget persistence)
// ──────────────────────────────────────────────────────────────

export function addDeck(name: string): Deck {
  const deck: Deck = { id: uid(), name, createdAt: Date.now() };
  decks.update(d => [...d, deck]);
  persist(invoke('db_save_deck', { deck }));
  return deck;
}

export function deleteDeck(id: string): void {
  decks.update(d => d.filter(dk => dk.id !== id));
  cards.update(c => c.filter(card => card.deckId !== id));
  persist(invoke('db_delete_deck', { id }));
  // Cards are removed from the DB by the foreign-key cascade.
}

export function addCard(
  deckId: string,
  front: string,
  back: string,
  tags: string[] = [],
): Card {
  const t = Date.now();
  const card: Card = {
    id: uid(),
    deckId,
    front,
    back,
    stability: null,
    difficulty: null,
    lastReview: null,
    interval: 0,
    ease: 2.5,
    due: t,
    reps: 0,
    lapses: 0,
    state: 'new',
    tags,
    createdAt: t,
    editedAt: t,
    flag: 0,
    position: 0,
  };
  cards.update(c => [...c, card]);
  persist(invoke('db_save_card', { card }));
  return card;
}

export function updateCard(id: string, updates: Partial<Card>): void {
  let updated: Card | undefined;
  cards.update(all =>
    all.map(c => {
      if (c.id !== id) return c;
      updated = { ...c, ...updates, editedAt: Date.now() };
      return updated;
    }),
  );
  if (updated) persist(invoke('db_save_card', { card: updated }));
}

export function deleteCard(id: string): void {
  cards.update(c => c.filter(card => card.id !== id));
  persist(invoke('db_delete_card', { id }));
}

/** Apply a precomputed FSRS scheduling choice to a card and persist it. */
export function applyFsrsChoice(
  id: string,
  rating: 'again' | 'hard' | 'good' | 'easy',
  choice: { interval: number; stability: number; difficulty: number },
): void {
  let updated: Card | undefined;
  cards.update(all =>
    all.map(c => {
      if (c.id !== id) return c;
      const now = Date.now();
      const isLapse = rating === 'again';
      updated = {
        ...c,
        stability: choice.stability,
        difficulty: choice.difficulty,
        lastReview: now,
        interval: choice.interval,
        due: now + choice.interval * 86_400_000,
        reps: c.reps + 1,
        lapses: isLapse ? c.lapses + 1 : c.lapses,
        state: isLapse ? 'learning' : 'review',
        editedAt: now,
      };
      return updated;
    }),
  );
  if (updated) persist(invoke('db_save_card', { card: updated }));
}

/** Bulk-add many cards (used by AI generate). */
export function addCardsBulk(deckId: string, items: { front: string; back: string }[], tags: string[] = []): Card[] {
  const t = Date.now();
  const newCards: Card[] = items.map(item => ({
    id: uid(),
    deckId,
    front: item.front,
    back: item.back,
    stability: null,
    difficulty: null,
    lastReview: null,
    interval: 0,
    ease: 2.5,
    due: t,
    reps: 0,
    lapses: 0,
    state: 'new',
    tags,
    createdAt: t,
    editedAt: t,
    flag: 0,
    position: 0,
  }));
  cards.update(c => [...c, ...newCards]);
  persist(invoke('db_save_cards_bulk', { cards: newCards }));
  return newCards;
}

// ──────────────────────────────────────────────────────────────
// Demo seed (first run only)
// ──────────────────────────────────────────────────────────────

function buildDemoData(): Snapshot {
  const t = Date.now();
  const day = 86_400_000;

  const demoDeck: Deck = { id: 'demo', name: 'Japanese N2', createdAt: t };
  const demoDeck2: Deck = { id: 'demo2', name: 'Rust Patterns', createdAt: t };

  const make = (partial: Partial<Card> & Pick<Card, 'deckId' | 'front' | 'back'>): Card => ({
    id: uid(),
    stability: null,
    difficulty: null,
    lastReview: null,
    interval: 0,
    ease: 2.5,
    due: t,
    reps: 0,
    lapses: 0,
    state: 'new',
    tags: [],
    createdAt: t,
    editedAt: t,
    flag: 0,
    position: 0,
    ...partial,
  });

  const seedCards: Card[] = [
    make({ deckId: 'demo', front: '食べ物', back: 'Food; edible things\nたべもの', tags: ['vocab', 'noun'], createdAt: t - 5*day }),
    make({ deckId: 'demo', front: '曖昧', back: 'Ambiguous; vague\nあいまい', tags: ['vocab', 'adjective'], createdAt: t - 4*day }),
    make({ deckId: 'demo', front: '相変わらず', back: 'As usual; as always\nあいかわらず',
      stability: 1.5, difficulty: 5.5, lastReview: t - day,
      interval: 1, due: t, reps: 1, state: 'review', tags: ['grammar', 'idiom'], createdAt: t - 10*day, flag: 2 }),
    make({ deckId: 'demo', front: '思い切って', back: 'Daringly; resolutely\nおもいきって',
      stability: 3.2, difficulty: 5.0, lastReview: t - 3*day,
      interval: 3, due: t + day, reps: 2, state: 'review', tags: ['grammar', 'adverb'], createdAt: t - 12*day, flag: 3 }),
    make({ deckId: 'demo', front: '振り返る', back: 'To look back; to reflect\nふりかえる', tags: ['vocab', 'verb'], createdAt: t - 2*day }),
    make({ deckId: 'demo2', front: 'What does `Box<dyn Trait>` do?', back: 'Heap-allocates a trait object, enabling dynamic dispatch. Sized at pointer width + vtable pointer.', tags: ['ownership', 'trait-objects'], createdAt: t - 7*day }),
    make({ deckId: 'demo2', front: 'When to use `Rc<T>` vs `Arc<T>`?', back: '`Rc<T>` — single-threaded reference counting.\n`Arc<T>` — atomic (thread-safe) reference counting.\nUse Arc only when sharing across threads.',
      stability: 2.4, difficulty: 6.0, lastReview: t - 2*day,
      interval: 2, due: t, reps: 1, state: 'review', tags: ['ownership', 'concurrency'], createdAt: t - 9*day, flag: 1 }),
  ];

  return { decks: [demoDeck, demoDeck2], cards: seedCards };
}

// Re-export for components that need imperative access
export { get };
