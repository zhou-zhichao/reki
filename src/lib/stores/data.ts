import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { extractClozeNumbers, hasCloze } from '../cloze';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface Card {
  id: string;
  deckId: string;
  noteId: string;
  ordinal: number;
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

export interface Note {
  id: string;
  deckId: string;
  noteType: 'basic' | 'cloze';
  front: string;
  back: string;
  tags: string[];
  createdAt: number;
  editedAt: number;
}

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
}

interface Snapshot {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
}

// ──────────────────────────────────────────────────────────────
// Stores
// ──────────────────────────────────────────────────────────────

export const decks = writable<Deck[]>([]);
export const notes = writable<Note[]>([]);
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

/** Load decks, notes, and cards from SQLite. Seeds demo data on first run. */
export async function loadFromDb(): Promise<void> {
  try {
    const snap = await invoke<Snapshot>('db_load_all');
    if (snap.decks.length === 0 && snap.cards.length === 0) {
      const seed = buildDemoData();
      decks.set(seed.decks);
      notes.set(seed.notes);
      cards.set(seed.cards);
      // Persist the seed so the user can see the same state next launch.
      for (const d of seed.decks) {
        await invoke('db_save_deck', { deck: d });
      }
      for (const n of seed.notes) {
        await invoke('db_save_note', { note: n });
      }
      await invoke('db_save_cards_bulk', { cards: seed.cards });
    } else {
      decks.set(snap.decks);
      notes.set(snap.notes ?? []);
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
  notes.update(n => n.filter(note => note.deckId !== id));
  cards.update(c => c.filter(card => card.deckId !== id));
  persist(invoke('db_delete_deck', { id }));
  // Cards and notes are removed from the DB by the foreign-key cascade.
}

export function addCard(
  deckId: string,
  front: string,
  back: string,
  tags: string[] = [],
): Card {
  const { newCards } = addNote(deckId, 'basic', front, back, tags);
  return newCards[0];
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
  let prevLastReview: number | null = null;
  cards.update(all =>
    all.map(c => {
      if (c.id !== id) return c;
      prevLastReview = c.lastReview;
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
  if (updated) {
    persist(invoke('db_save_card', { card: updated }));
    const elapsed = prevLastReview != null
      ? Math.max(0, Math.floor((Date.now() - prevLastReview) / 86_400_000))
      : 0;
    persist(invoke('db_log_review', {
      log: {
        cardId: id,
        deckId: updated.deckId,
        rating,
        elapsedDays: elapsed,
        newStability: choice.stability,
        newDifficulty: choice.difficulty,
        newInterval: choice.interval,
        reviewedAt: Date.now(),
      }
    }));
  }
}

export function addNote(
  deckId: string,
  noteType: 'basic' | 'cloze',
  front: string,
  back: string,
  tags: string[] = [],
): { note: Note; newCards: Card[] } {
  const t = Date.now();
  const note: Note = {
    id: uid(), deckId, noteType, front, back, tags, createdAt: t, editedAt: t,
  };
  const ordinals = noteType === 'cloze' ? extractClozeNumbers(front) : [0];
  const newCards: Card[] = ordinals.map(ord => ({
    id: uid(), deckId, noteId: note.id, ordinal: ord,
    front, back,
    stability: null, difficulty: null, lastReview: null,
    interval: 0, ease: 2.5, due: t, reps: 0, lapses: 0,
    state: 'new' as const, tags, createdAt: t, editedAt: t, flag: 0, position: 0,
  }));
  notes.update(n => [...n, note]);
  cards.update(c => [...c, ...newCards]);
  persist(invoke('db_save_note', { note }));
  persist(invoke('db_save_cards_bulk', { cards: newCards }));
  return { note, newCards };
}

export function updateNote(
  noteId: string,
  changes: { front?: string; back?: string; tags?: string[] },
): void {
  let updatedNote: Note | undefined;
  notes.update(all =>
    all.map(n => {
      if (n.id !== noteId) return n;
      updatedNote = { ...n, ...changes, editedAt: Date.now() };
      return updatedNote;
    }),
  );
  if (!updatedNote) return;

  if (updatedNote.noteType === 'cloze' && changes.front !== undefined) {
    const newOrdinals = extractClozeNumbers(changes.front);
    const currentCards = get(cards).filter(c => c.noteId === noteId);
    const currentOrdinals = currentCards.map(c => c.ordinal);

    // Remove cards for deleted cloze numbers
    const toRemove = currentCards.filter(c => !newOrdinals.includes(c.ordinal));
    for (const c of toRemove) {
      cards.update(all => all.filter(card => card.id !== c.id));
      persist(invoke('db_delete_card', { id: c.id }));
    }

    // Add cards for new cloze numbers
    const t = Date.now();
    const toAdd = newOrdinals.filter(o => !currentOrdinals.includes(o));
    const addedCards: Card[] = toAdd.map(ord => ({
      id: uid(), deckId: updatedNote!.deckId, noteId, ordinal: ord,
      front: updatedNote!.front, back: updatedNote!.back,
      stability: null, difficulty: null, lastReview: null,
      interval: 0, ease: 2.5, due: t, reps: 0, lapses: 0,
      state: 'new' as const, tags: updatedNote!.tags, createdAt: t, editedAt: t, flag: 0, position: 0,
    }));
    if (addedCards.length > 0) {
      cards.update(c => [...c, ...addedCards]);
      persist(invoke('db_save_cards_bulk', { cards: addedCards }));
    }

    // Update kept cards' content snapshot
    const kept = newOrdinals.filter(o => currentOrdinals.includes(o));
    const snapshot = get(cards);
    for (const ord of kept) {
      const cardToUpdate = snapshot.find(c => c.noteId === noteId && c.ordinal === ord);
      if (cardToUpdate) {
        updateCard(cardToUpdate.id, { front: updatedNote.front, back: updatedNote.back, tags: updatedNote.tags });
      }
    }
  } else {
    // Basic note: update the single card
    const card = get(cards).find(c => c.noteId === noteId);
    if (card) {
      updateCard(card.id, { front: updatedNote.front, back: updatedNote.back, tags: updatedNote.tags ?? card.tags });
    }
  }

  persist(invoke('db_save_note', { note: updatedNote }));
}

export function deleteNote(noteId: string): void {
  notes.update(n => n.filter(note => note.id !== noteId));
  cards.update(c => c.filter(card => card.noteId !== noteId));
  persist(invoke('db_delete_note', { id: noteId }));
}

/** Bulk-add many cards (used by AI generate). Routes through addNote. */
export function addCardsBulk(
  deckId: string,
  items: { front: string; back: string }[],
  tags: string[] = [],
  noteType: 'basic' | 'cloze' = 'basic',
): Card[] {
  const allCards: Card[] = [];
  for (const item of items) {
    const type = noteType === 'cloze' || hasCloze(item.front) ? 'cloze' : 'basic';
    const { newCards } = addNote(deckId, type, item.front, item.back, tags);
    allCards.push(...newCards);
  }
  return allCards;
}

// ──────────────────────────────────────────────────────────────
// Demo seed (first run only)
// ──────────────────────────────────────────────────────────────

function buildDemoData(): { decks: Deck[]; notes: Note[]; cards: Card[] } {
  const t = Date.now();
  const day = 86_400_000;

  const demoDeck: Deck = { id: 'demo', name: 'Japanese N2', createdAt: t };
  const demoDeck2: Deck = { id: 'demo2', name: 'Rust Patterns', createdAt: t };

  const demoNotes: Note[] = [];

  const makeNote = (
    deckId: string,
    front: string,
    back: string,
    tags: string[] = [],
    createdAt: number = t,
  ): Note => {
    const note: Note = {
      id: uid(),
      deckId,
      noteType: 'basic',
      front,
      back,
      tags,
      createdAt,
      editedAt: createdAt,
    };
    demoNotes.push(note);
    return note;
  };

  const make = (
    note: Note,
    partial: Partial<Card> = {},
  ): Card => ({
    id: uid(),
    deckId: note.deckId,
    noteId: note.id,
    ordinal: 0,
    front: note.front,
    back: note.back,
    stability: null,
    difficulty: null,
    lastReview: null,
    interval: 0,
    ease: 2.5,
    due: t,
    reps: 0,
    lapses: 0,
    state: 'new',
    tags: note.tags,
    createdAt: note.createdAt,
    editedAt: note.createdAt,
    flag: 0,
    position: 0,
    ...partial,
  });

  const n1 = makeNote('demo', '食べ物', 'Food; edible things\nたべもの', ['vocab', 'noun'], t - 5*day);
  const n2 = makeNote('demo', '曖昧', 'Ambiguous; vague\nあいまい', ['vocab', 'adjective'], t - 4*day);
  const n3 = makeNote('demo', '相変わらず', 'As usual; as always\nあいかわらず', ['grammar', 'idiom'], t - 10*day);
  const n4 = makeNote('demo', '思い切って', 'Daringly; resolutely\nおもいきって', ['grammar', 'adverb'], t - 12*day);
  const n5 = makeNote('demo', '振り返る', 'To look back; to reflect\nふりかえる', ['vocab', 'verb'], t - 2*day);
  const n6 = makeNote('demo2', 'What does `Box<dyn Trait>` do?', 'Heap-allocates a trait object, enabling dynamic dispatch. Sized at pointer width + vtable pointer.', ['ownership', 'trait-objects'], t - 7*day);
  const n7 = makeNote('demo2', 'When to use `Rc<T>` vs `Arc<T>`?', '`Rc<T>` — single-threaded reference counting.\n`Arc<T>` — atomic (thread-safe) reference counting.\nUse Arc only when sharing across threads.', ['ownership', 'concurrency'], t - 9*day);

  const seedCards: Card[] = [
    make(n1),
    make(n2),
    make(n3, {
      stability: 1.5, difficulty: 5.5, lastReview: t - day,
      interval: 1, due: t, reps: 1, state: 'review', flag: 2,
    }),
    make(n4, {
      stability: 3.2, difficulty: 5.0, lastReview: t - 3*day,
      interval: 3, due: t + day, reps: 2, state: 'review', flag: 3,
    }),
    make(n5),
    make(n6),
    make(n7, {
      stability: 2.4, difficulty: 6.0, lastReview: t - 2*day,
      interval: 2, due: t, reps: 1, state: 'review', flag: 1,
    }),
  ];

  return { decks: [demoDeck, demoDeck2], notes: demoNotes, cards: seedCards };
}

// Re-export for components that need imperative access
export { get };
