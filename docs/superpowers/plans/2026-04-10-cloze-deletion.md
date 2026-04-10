# Cloze Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anki-style cloze deletion with a Note layer so `{{c1::answer::hint}}` generates independently scheduled cards.

**Architecture:** Introduce a `notes` table (types: `basic` | `cloze`). Every card belongs to a note. Cloze notes produce N cards (one per distinct `{{cN::}}` number). Migrate existing cards into basic notes. Cloze parsing lives in a standalone TypeScript module; rendering is a preprocessing step before the existing marked pipeline.

**Tech Stack:** Rust/SQLite (backend), Svelte 5/TypeScript (frontend), vitest (TS tests), cargo test (Rust tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/cloze.ts` | Create | Cloze parsing, rendering, detection |
| `src/lib/cloze.test.ts` | Create | Tests for cloze module |
| `src-tauri/src/db.rs` | Modify | Notes table, migration v2, Note struct, CRUD commands |
| `src/lib/stores/data.ts` | Modify | Note type/store, addNote/updateNote/deleteNote, wire to Tauri |
| `src/lib/markdown.ts` | Modify | Add `renderMarkdownCloze` function |
| `src/lib/components/Markdown.svelte` | Modify | Accept optional cloze ordinal + revealed props |
| `src/lib/pages/ReviewPage.svelte` | Modify | Cloze-aware card rendering |
| `src/lib/pages/BrowsePage.svelte` | Modify | Edit notes, show type column |
| `src/lib/pages/GeneratePage.svelte` | Modify | Cloze mode toggle |
| `src-tauri/src/lib.rs` | Modify | Register note commands, add cloze AI prompt |
| `src/lib/query.ts` | Modify | Add `note_type:` and `has:cloze` predicates |

---

### Task 1: Cloze Parsing Module (cloze.ts)

**Files:**
- Create: `src/lib/cloze.ts`
- Test: `src/lib/cloze.test.ts`

- [ ] **Step 1: Write the failing tests for cloze parsing**

Create `src/lib/cloze.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseClozes, extractClozeNumbers, renderClozeFront, renderClozeBack, hasCloze } from './cloze';

describe('parseClozes', () => {
  it('parses a single cloze without hint', () => {
    const result = parseClozes('The capital is {{c1::Paris}}');
    expect(result).toEqual([
      { num: 1, answer: 'Paris', hint: undefined, start: 15, end: 28 },
    ]);
  });

  it('parses a cloze with hint', () => {
    const result = parseClozes('Capital is {{c1::Paris::European city}}');
    expect(result).toEqual([
      { num: 1, answer: 'Paris', hint: 'European city', start: 11, end: 39 },
    ]);
  });

  it('parses multiple clozes', () => {
    const result = parseClozes('{{c1::Paris}} is in {{c2::France}}');
    expect(result).toHaveLength(2);
    expect(result[0].num).toBe(1);
    expect(result[1].num).toBe(2);
  });

  it('returns empty array for no clozes', () => {
    expect(parseClozes('No clozes here')).toEqual([]);
  });

  it('handles empty answer', () => {
    const result = parseClozes('{{c1::}}');
    expect(result[0].answer).toBe('');
  });
});

describe('extractClozeNumbers', () => {
  it('returns sorted unique numbers', () => {
    expect(extractClozeNumbers('{{c3::a}} {{c1::b}} {{c3::c}}')).toEqual([1, 3]);
  });

  it('returns empty for no clozes', () => {
    expect(extractClozeNumbers('plain text')).toEqual([]);
  });
});

describe('hasCloze', () => {
  it('returns true for text with cloze', () => {
    expect(hasCloze('{{c1::test}}')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasCloze('no cloze')).toBe(false);
  });
});

describe('renderClozeFront', () => {
  it('blanks the active cloze, shows others', () => {
    const text = '{{c1::Paris}} is in {{c2::France}}';
    const result = renderClozeFront(text, 1);
    expect(result).toContain('<span class="cloze-blank">[...]</span>');
    expect(result).toContain('France');
    expect(result).not.toContain('{{c2::');
  });

  it('uses hint when provided', () => {
    const text = '{{c1::Paris::a city}}';
    const result = renderClozeFront(text, 1);
    expect(result).toContain('<span class="cloze-blank">[a city]</span>');
  });

  it('blanks all occurrences of same cloze number', () => {
    const text = '{{c1::A}} and {{c1::B}}';
    const result = renderClozeFront(text, 1);
    const blanks = result.match(/cloze-blank/g);
    expect(blanks).toHaveLength(2);
  });
});

describe('renderClozeBack', () => {
  it('highlights the active cloze, shows others plain', () => {
    const text = '{{c1::Paris}} is in {{c2::France}}';
    const result = renderClozeBack(text, 1);
    expect(result).toContain('<span class="cloze-answer">Paris</span>');
    expect(result).toContain('France');
    expect(result).not.toContain('{{');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/cloze.test.ts`
Expected: FAIL — module `./cloze` not found

- [ ] **Step 3: Implement cloze.ts**

Create `src/lib/cloze.ts`:

```typescript
/**
 * Cloze deletion parser and renderer.
 *
 * Syntax:  {{c<N>::<answer>}}  or  {{c<N>::<answer>::<hint>}}
 * N is a positive integer. Answer and hint can contain any text except `}}`.
 */

export interface Cloze {
  num: number;
  answer: string;
  hint: undefined | string;
  start: number;
  end: number;
}

const CLOZE_RE = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g;

/**
 * Parse all cloze markers in text, returning their positions and content.
 */
export function parseClozes(text: string): Cloze[] {
  const results: Cloze[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CLOZE_RE.source, CLOZE_RE.flags);
  while ((m = re.exec(text)) !== null) {
    results.push({
      num: parseInt(m[1], 10),
      answer: m[2],
      hint: m[3] !== undefined ? m[3] : undefined,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return results;
}

/**
 * Return sorted unique cloze numbers found in text.
 */
export function extractClozeNumbers(text: string): number[] {
  const nums = new Set<number>();
  for (const c of parseClozes(text)) nums.add(c.num);
  return [...nums].sort((a, b) => a - b);
}

/**
 * Check if text contains any cloze markers.
 */
export function hasCloze(text: string): boolean {
  return CLOZE_RE.test(text);
}

/**
 * Render cloze text for the front of a card (question side).
 * Active ordinal: replaced with blank/hint.  Other clozes: show answer inline.
 */
export function renderClozeFront(text: string, ordinal: number): string {
  return text.replace(
    new RegExp(CLOZE_RE.source, CLOZE_RE.flags),
    (_match, num: string, answer: string, hint: string | undefined) => {
      if (parseInt(num, 10) === ordinal) {
        const label = hint !== undefined ? hint : '...';
        return `<span class="cloze-blank">[${label}]</span>`;
      }
      return answer;
    },
  );
}

/**
 * Render cloze text for the back of a card (answer side).
 * Active ordinal: highlighted.  Other clozes: show answer inline.
 */
export function renderClozeBack(text: string, ordinal: number): string {
  return text.replace(
    new RegExp(CLOZE_RE.source, CLOZE_RE.flags),
    (_match, num: string, answer: string) => {
      if (parseInt(num, 10) === ordinal) {
        return `<span class="cloze-answer">${answer}</span>`;
      }
      return answer;
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/cloze.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/cloze.ts src/lib/cloze.test.ts
git commit -m "feat: add cloze parsing module with tests"
```

---

### Task 2: Markdown Cloze Integration (markdown.ts)

**Files:**
- Modify: `src/lib/markdown.ts:225-236`
- Test: `src/lib/cloze.test.ts` (append)

- [ ] **Step 1: Add cloze rendering test to cloze.test.ts**

Append to `src/lib/cloze.test.ts`:

```typescript
import { renderMarkdownCloze } from './markdown';

describe('renderMarkdownCloze', () => {
  it('renders cloze front with markdown', async () => {
    const html = await renderMarkdownCloze('**Bold** {{c1::Paris}}', 1, false);
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('cloze-blank');
  });

  it('renders cloze back with highlighted answer', async () => {
    const html = await renderMarkdownCloze('{{c1::Paris}}', 1, true);
    expect(html).toContain('cloze-answer');
    expect(html).toContain('Paris');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/cloze.test.ts`
Expected: FAIL — `renderMarkdownCloze` not exported from `./markdown`

- [ ] **Step 3: Add renderMarkdownCloze to markdown.ts**

Add after the existing `renderMarkdown` function (after line 236 of `src/lib/markdown.ts`):

```typescript
import { renderClozeFront, renderClozeBack } from './cloze';

/**
 * Render Markdown with cloze preprocessing.
 * Cloze markers are resolved before markdown parsing.
 */
export async function renderMarkdownCloze(
  src: string,
  ordinal: number,
  revealed: boolean,
): Promise<string> {
  const processed = revealed
    ? renderClozeBack(src, ordinal)
    : renderClozeFront(src, ordinal);
  return renderMarkdown(processed);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/cloze.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/markdown.ts src/lib/cloze.test.ts
git commit -m "feat: add renderMarkdownCloze to markdown pipeline"
```

---

### Task 3: Rust Backend — Notes Table & Migration (db.rs)

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write failing Rust test for migration v2**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db.rs`:

```rust
#[test]
fn migration_v2_creates_notes_table() {
    let conn = test_conn();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='notes'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn migration_v2_cards_have_note_id_and_ordinal() {
    let conn = test_conn();
    // Insert a deck and card at v1 level, then verify note_id/ordinal columns exist
    upsert_deck(
        &conn,
        &Deck { id: "d1".into(), name: "Test".into(), created_at: 0 },
    ).unwrap();
    let note = Note {
        id: "n1".into(),
        deck_id: "d1".into(),
        note_type: "basic".into(),
        front: "Q".into(),
        back: "A".into(),
        tags: vec![],
        created_at: 100,
        edited_at: 100,
    };
    upsert_note(&conn, &note).unwrap();
    let card = Card {
        id: "c1".into(),
        deck_id: "d1".into(),
        note_id: "n1".into(),
        ordinal: 0,
        front: "Q".into(),
        back: "A".into(),
        stability: None,
        difficulty: None,
        last_review: None,
        interval: 0,
        due: 0,
        reps: 0,
        lapses: 0,
        state: "new".into(),
        ease: 2.5,
        tags: vec![],
        created_at: 100,
        edited_at: 100,
        flag: 0,
        position: 0,
    };
    upsert_card(&conn, &card).unwrap();
    let cards = list_all_cards(&conn).unwrap();
    assert_eq!(cards[0].note_id, "n1");
    assert_eq!(cards[0].ordinal, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/anki-rewrite/src-tauri && cargo test`
Expected: FAIL — no `Note` struct, no `notes` table, no `note_id`/`ordinal` fields on `Card`

- [ ] **Step 3: Add Note struct and update Card struct**

In `src-tauri/src/db.rs`, add the Note struct after the Card struct (after line 54):

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub deck_id: String,
    pub note_type: String,
    pub front: String,
    pub back: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub edited_at: i64,
}
```

Add `note_id` and `ordinal` fields to the Card struct (after `deck_id` on line 34):

```rust
pub note_id: String,
pub ordinal: i64,
```

Update the Snapshot struct to include notes:

```rust
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub decks: Vec<Deck>,
    pub notes: Vec<Note>,
    pub cards: Vec<Card>,
}
```

- [ ] **Step 4: Add migration v2 and notes CRUD**

Add migration v2 inside the `migrate` function (after `set_version(conn, 1)?;` on line 150):

```rust
if v < 2 {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS notes (
            id          TEXT PRIMARY KEY,
            deck_id     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            note_type   TEXT NOT NULL DEFAULT 'basic',
            front       TEXT NOT NULL DEFAULT '',
            back        TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '[]',
            created_at  INTEGER NOT NULL,
            edited_at   INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS notes_deck_id ON notes(deck_id);

        ALTER TABLE cards ADD COLUMN note_id TEXT REFERENCES notes(id) ON DELETE CASCADE DEFAULT '';
        ALTER TABLE cards ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;
        "#,
    )?;

    // Migrate existing cards: create a basic note for each card
    let mut stmt = conn.prepare(
        "SELECT id, deck_id, front, back, tags, created_at, edited_at FROM cards WHERE note_id = ''"
    )?;
    let rows: Vec<(String, String, String, String, String, i64, i64)> = stmt
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for (card_id, deck_id, front, back, tags, created_at, edited_at) in &rows {
        let note_id = format!("n_{card_id}");
        conn.execute(
            "INSERT INTO notes (id, deck_id, note_type, front, back, tags, created_at, edited_at)
             VALUES (?1, ?2, 'basic', ?3, ?4, ?5, ?6, ?7)",
            params![note_id, deck_id, front, back, tags, created_at, edited_at],
        )?;
        conn.execute(
            "UPDATE cards SET note_id = ?1, ordinal = 0 WHERE id = ?2",
            params![note_id, card_id],
        )?;
    }

    set_version(conn, 2)?;
}
```

Add row mapper and CRUD for notes:

```rust
fn row_to_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_json: String = r.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Note {
        id: r.get("id")?,
        deck_id: r.get("deck_id")?,
        note_type: r.get("note_type")?,
        front: r.get("front")?,
        back: r.get("back")?,
        tags,
        created_at: r.get("created_at")?,
        edited_at: r.get("edited_at")?,
    })
}

pub fn list_all_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare("SELECT * FROM notes ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_note)?;
    rows.collect()
}

pub fn upsert_note(conn: &Connection, n: &Note) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&n.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO notes (id, deck_id, note_type, front, back, tags, created_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            deck_id = excluded.deck_id,
            note_type = excluded.note_type,
            front = excluded.front,
            back = excluded.back,
            tags = excluded.tags,
            edited_at = excluded.edited_at",
        params![n.id, n.deck_id, n.note_type, n.front, n.back, tags_json, n.created_at, n.edited_at],
    )?;
    Ok(())
}

pub fn delete_note_row(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_cards_by_note(conn: &Connection, note_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM cards WHERE note_id = ?1", params![note_id])?;
    Ok(())
}
```

Update `row_to_card` to read the new columns (add after `deck_id` in the Card constructor):

```rust
note_id: r.get("note_id")?,
ordinal: r.get("ordinal")?,
```

Update `upsert_card` to include `note_id` and `ordinal` in INSERT and UPDATE.

Update `list_all_decks` caller in `db_load_all` to also load notes:

```rust
#[tauri::command]
pub fn db_load_all(state: State<'_, DbState>) -> Result<Snapshot, String> {
    let conn = state.lock().map_err(lock_err)?;
    let decks = list_all_decks(&conn).map_err(db_err)?;
    let notes = list_all_notes(&conn).map_err(db_err)?;
    let cards = list_all_cards(&conn).map_err(db_err)?;
    Ok(Snapshot { decks, notes, cards })
}
```

Add new Tauri commands:

```rust
#[tauri::command]
pub fn db_save_note(state: State<'_, DbState>, note: Note) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    upsert_note(&conn, &note).map_err(db_err)
}

#[tauri::command]
pub fn db_delete_note(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    delete_note_row(&conn, &id).map_err(db_err)
}
```

- [ ] **Step 5: Update all existing Card test helpers to include note_id/ordinal**

Every test that constructs a Card literal needs `note_id: "...".into()` and `ordinal: 0`. Update the existing tests: `upsert_and_list_cards`, `deleting_deck_cascades_to_cards`.

For tests that create cards, first create a note for the FK:

```rust
// Add before card creation in each test:
upsert_note(
    &conn,
    &Note {
        id: "n1".into(),
        deck_id: "d1".into(),
        note_type: "basic".into(),
        front: "f".into(),
        back: "b".into(),
        tags: vec![],
        created_at: 0,
        edited_at: 0,
    },
).unwrap();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/anki-rewrite/src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd ~/anki-rewrite
git add src-tauri/src/db.rs
git commit -m "feat: add notes table, migration v2, note CRUD commands"
```

---

### Task 4: Register Note Commands in Tauri (lib.rs)

**Files:**
- Modify: `src-tauri/src/lib.rs:132-145`

- [ ] **Step 1: Register new commands in the Tauri handler**

In `src-tauri/src/lib.rs`, add `db::db_save_note` and `db::db_delete_note` to the `generate_handler!` macro (line 134):

```rust
.invoke_handler(tauri::generate_handler![
    generate_cards,
    srs::fsrs_next_states,
    db::db_load_all,
    db::db_save_deck,
    db::db_delete_deck,
    db::db_save_card,
    db::db_delete_card,
    db::db_save_cards_bulk,
    db::db_save_note,
    db::db_delete_note,
    media::media_save_blob,
    media::media_clean_unused,
])
```

- [ ] **Step 2: Verify compilation**

Run: `cd ~/anki-rewrite/src-tauri && cargo check`
Expected: Compiles without errors

- [ ] **Step 3: Commit**

```bash
cd ~/anki-rewrite
git add src-tauri/src/lib.rs
git commit -m "feat: register note CRUD commands in Tauri handler"
```

---

### Task 5: Frontend Data Layer — Note Store & Mutations (data.ts)

**Files:**
- Modify: `src/lib/stores/data.ts`

- [ ] **Step 1: Add Note type and store**

Add after the `Card` interface (after line 34 in `src/lib/stores/data.ts`):

```typescript
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
```

Update the `Snapshot` interface:

```typescript
interface Snapshot {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
}
```

Add `noteId` and `ordinal` to the `Card` interface (after `deckId`):

```typescript
noteId: string;
ordinal: number;
```

Add note store:

```typescript
export const notes = writable<Note[]>([]);
```

- [ ] **Step 2: Update loadFromDb to load notes**

In `loadFromDb`, update the snapshot handling (around line 82-96) to also set notes:

```typescript
export async function loadFromDb(): Promise<void> {
  try {
    const snap = await invoke<Snapshot>('db_load_all');
    if (snap.decks.length === 0 && snap.cards.length === 0) {
      const seed = buildDemoData();
      decks.set(seed.decks);
      notes.set(seed.notes);
      cards.set(seed.cards);
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
    dataLoaded.set(true);
  }
}
```

- [ ] **Step 3: Add addNote, updateNote, deleteNote functions**

Add after the existing `deleteCard` function:

```typescript
import { extractClozeNumbers, hasCloze } from '../cloze';

export function addNote(
  deckId: string,
  noteType: 'basic' | 'cloze',
  front: string,
  back: string,
  tags: string[] = [],
): { note: Note; newCards: Card[] } {
  const t = Date.now();
  const note: Note = {
    id: uid(),
    deckId,
    noteType,
    front,
    back,
    tags,
    createdAt: t,
    editedAt: t,
  };

  const ordinals = noteType === 'cloze' ? extractClozeNumbers(front) : [0];

  const newCards: Card[] = ordinals.map(ord => ({
    id: uid(),
    deckId,
    noteId: note.id,
    ordinal: ord,
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
    state: 'new' as const,
    tags,
    createdAt: t,
    editedAt: t,
    flag: 0,
    position: 0,
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
      id: uid(),
      deckId: updatedNote!.deckId,
      noteId,
      ordinal: ord,
      front: updatedNote!.front,
      back: updatedNote!.back,
      stability: null,
      difficulty: null,
      lastReview: null,
      interval: 0,
      ease: 2.5,
      due: t,
      reps: 0,
      lapses: 0,
      state: 'new' as const,
      tags: updatedNote!.tags,
      createdAt: t,
      editedAt: t,
      flag: 0,
      position: 0,
    }));
    if (addedCards.length > 0) {
      cards.update(c => [...c, ...addedCards]);
      persist(invoke('db_save_cards_bulk', { cards: addedCards }));
    }

    // Update existing cards' content snapshot
    const kept = newOrdinals.filter(o => currentOrdinals.includes(o));
    for (const ord of kept) {
      const cardToUpdate = get(cards).find(c => c.noteId === noteId && c.ordinal === ord);
      if (cardToUpdate) {
        updateCard(cardToUpdate.id, {
          front: updatedNote.front,
          back: updatedNote.back,
          tags: updatedNote.tags,
        });
      }
    }
  } else {
    // Basic note: update the single card
    const card = get(cards).find(c => c.noteId === noteId);
    if (card) {
      updateCard(card.id, {
        front: updatedNote.front,
        back: updatedNote.back,
        tags: updatedNote.tags ?? card.tags,
      });
    }
  }

  persist(invoke('db_save_note', { note: updatedNote }));
}

export function deleteNote(noteId: string): void {
  notes.update(n => n.filter(note => note.id !== noteId));
  cards.update(c => c.filter(card => card.noteId !== noteId));
  persist(invoke('db_delete_note', { id: noteId }));
  // Cards are removed from DB by foreign key cascade
}
```

- [ ] **Step 4: Update buildDemoData to create notes for demo cards**

Update `buildDemoData` (around line 233). Each demo card needs a parent note. Update the `make` helper and seed to include `noteId` and `ordinal`:

```typescript
function buildDemoData(): Snapshot {
  const t = Date.now();
  const day = 86_400_000;

  const demoDeck: Deck = { id: 'demo', name: 'Japanese N2', createdAt: t };
  const demoDeck2: Deck = { id: 'demo2', name: 'Rust Patterns', createdAt: t };

  let noteIndex = 0;
  const demoNotes: Note[] = [];

  const makeNote = (deckId: string, front: string, back: string, tags: string[], createdAt: number): Note => {
    const note: Note = {
      id: `demo-note-${noteIndex++}`,
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

  const make = (noteRef: Note, partial: Partial<Card>): Card => ({
    id: uid(),
    deckId: noteRef.deckId,
    noteId: noteRef.id,
    ordinal: 0,
    front: noteRef.front,
    back: noteRef.back,
    stability: null,
    difficulty: null,
    lastReview: null,
    interval: 0,
    ease: 2.5,
    due: t,
    reps: 0,
    lapses: 0,
    state: 'new',
    tags: noteRef.tags,
    createdAt: noteRef.createdAt,
    editedAt: noteRef.createdAt,
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
    make(n1, {}),
    make(n2, {}),
    make(n3, { stability: 1.5, difficulty: 5.5, lastReview: t - day, interval: 1, due: t, reps: 1, state: 'review', flag: 2 }),
    make(n4, { stability: 3.2, difficulty: 5.0, lastReview: t - 3*day, interval: 3, due: t + day, reps: 2, state: 'review', flag: 3 }),
    make(n5, {}),
    make(n6, {}),
    make(n7, { stability: 2.4, difficulty: 6.0, lastReview: t - 2*day, interval: 2, due: t, reps: 1, state: 'review', flag: 1 }),
  ];

  return { decks: [demoDeck, demoDeck2], notes: demoNotes, cards: seedCards };
}
```

- [ ] **Step 5: Update addCardsBulk to use addNote**

Replace the existing `addCardsBulk` function to route through `addNote`:

```typescript
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
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/stores/data.ts
git commit -m "feat: add Note store, addNote/updateNote/deleteNote, update demo data"
```

---

### Task 6: Markdown.svelte — Cloze Props

**Files:**
- Modify: `src/lib/components/Markdown.svelte`

- [ ] **Step 1: Add optional cloze props to Markdown component**

Update `src/lib/components/Markdown.svelte` script block:

```svelte
<script lang="ts">
  import { renderMarkdown } from '../markdown';
  import { renderMarkdownCloze } from '../markdown';

  interface Props {
    src: string;
    clozeOrdinal?: number;
    clozeRevealed?: boolean;
  }
  let { src, clozeOrdinal, clozeRevealed = false }: Props = $props();

  let html = $state('');
  let pending = $state(false);

  $effect(() => {
    const current = src;
    const ordinal = clozeOrdinal;
    const revealed = clozeRevealed;
    pending = true;
    const promise = ordinal !== undefined
      ? renderMarkdownCloze(current, ordinal, revealed)
      : renderMarkdown(current);
    promise.then(result => {
      if (current === src) {
        html = result;
        pending = false;
      }
    });
  });
</script>
```

- [ ] **Step 2: Add cloze CSS styles to the component**

Append to the `<style>` block in `Markdown.svelte`:

```css
.md :global(.cloze-blank) {
  background: var(--cloze-blank-bg, color-mix(in srgb, var(--accent) 15%, transparent));
  color: var(--cloze-blank-color, var(--accent));
  padding: 0.1em 0.4em;
  border-radius: 3px;
  font-style: italic;
  font-weight: 500;
}

.md :global(.cloze-answer) {
  background: var(--cloze-answer-bg, color-mix(in srgb, var(--c-good) 15%, transparent));
  color: var(--cloze-answer-color, var(--c-good));
  padding: 0.1em 0.4em;
  border-radius: 3px;
  font-weight: 600;
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/components/Markdown.svelte
git commit -m "feat: add cloze ordinal/revealed props to Markdown component"
```

---

### Task 7: ReviewPage — Cloze-Aware Rendering

**Files:**
- Modify: `src/lib/pages/ReviewPage.svelte`

- [ ] **Step 1: Add note lookup for current card**

In ReviewPage.svelte, import `notes` store and add derived state. Update imports (line 3):

```typescript
import { dueCards, activeDeck, activeDeckId, applyFsrsChoice, cards, notes } from '../stores/data';
```

Add derived note lookup after `currentCard` (after line 14):

```typescript
const currentNote = $derived(
  currentCard ? $notes.find(n => n.id === currentCard.noteId) ?? null : null
);
const isCloze = $derived(currentNote?.noteType === 'cloze');
```

- [ ] **Step 2: Update card rendering for cloze**

Replace the card-content rendering (lines 130-136):

```svelte
<div class="card-content">
  {#if isCloze && currentNote}
    <div class="card-front">
      <Markdown src={currentNote.front} clozeOrdinal={currentCard.ordinal} clozeRevealed={showAnswer} />
    </div>
    {#if showAnswer && currentNote.back}
      <div class="card-divider"></div>
      <div class="card-back"><Markdown src={currentNote.back} /></div>
    {/if}
  {:else}
    <div class="card-front"><Markdown src={currentCard.front} /></div>
    {#if showAnswer}
      <div class="card-divider"></div>
      <div class="card-back"><Markdown src={currentCard.back} /></div>
    {/if}
  {/if}
</div>
```

- [ ] **Step 3: Verify compilation**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/pages/ReviewPage.svelte
git commit -m "feat: cloze-aware rendering in review page"
```

---

### Task 8: BrowsePage — Edit Notes, Type Column

**Files:**
- Modify: `src/lib/pages/BrowsePage.svelte`

- [ ] **Step 1: Import note-related functions and store**

Update imports at the top of BrowsePage.svelte (line 2):

```typescript
import { cards, decks, activeDeckId, updateCard, deleteCard, notes, updateNote, deleteNote, type Card, type Note } from '../stores/data';
```

Add note lookup state after `editBack` (after line 10):

```typescript
let selectedNote = $derived(
  selectedCard ? $notes.find(n => n.id === selectedCard.noteId) ?? null : null
);
```

- [ ] **Step 2: Add Type column to the table**

Add a `<th>` for Type after the Flag column (after line 169):

```svelte
<th class="col-type">Type</th>
```

Add `<td>` in the row (after the flag `<td>`, after line 186):

```svelte
<td class="col-type">
  <span class="type-badge" class:cloze={$notes.find(n => n.id === card.noteId)?.noteType === 'cloze'}>
    {$notes.find(n => n.id === card.noteId)?.noteType === 'cloze' ? 'Cloze' : 'Basic'}
  </span>
</td>
```

Update the `colspan` in the no-results row from 6 to 7.

- [ ] **Step 3: Update detail panel to edit notes**

Replace the saveEdit function:

```typescript
function saveEdit() {
  if (!selectedId || !selectedNote) return;
  updateNote(selectedNote.id, { front: editFront, back: editBack });
}

function removeCard() {
  if (!selectedId || !selectedNote) return;
  deleteNote(selectedNote.id);
  selectedId = null;
}
```

Update the detail header to say "Edit Note" when viewing a cloze:

```svelte
<h4>{selectedNote?.noteType === 'cloze' ? 'Edit Cloze Note' : 'Edit Card'}</h4>
```

Add card count info for cloze notes in the meta section:

```svelte
{#if selectedNote?.noteType === 'cloze'}
  <div class="meta-row">
    <span class="meta-label">Cards</span>
    <span>{$cards.filter(c => c.noteId === selectedNote?.id).length} cloze cards</span>
  </div>
{/if}
```

- [ ] **Step 4: Add CSS for the type column**

Add to the `<style>` block:

```css
.col-type { width: 60px; }

.type-badge {
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 1px 6px;
  border-radius: var(--r-sm);
  color: var(--text-muted);
}

.type-badge.cloze {
  color: var(--accent);
  background: var(--accent-bg);
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/pages/BrowsePage.svelte
git commit -m "feat: browse page shows note type, edits notes for cloze cards"
```

---

### Task 9: GeneratePage — Cloze Mode Toggle

**Files:**
- Modify: `src/lib/pages/GeneratePage.svelte`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add cloze parameter to Rust generate_cards**

In `src-tauri/src/lib.rs`, update the `generate_cards` function signature (line 16-20):

```rust
#[tauri::command]
async fn generate_cards(
    app: tauri::AppHandle,
    topic: String,
    count: Option<u32>,
    cloze: Option<bool>,
) -> Result<Vec<GeneratedCard>, String> {
    let n = count.unwrap_or(5);
    let is_cloze = cloze.unwrap_or(false);
```

Update the prompt construction (replace lines 22-31):

```rust
let prompt = if is_cloze {
    format!(
        "Generate exactly {n} high-quality cloze deletion flashcards about the following topic.\n\n\
        Topic: {topic}\n\n\
        Rules:\n\
        - Use cloze deletion format: {{{{c1::answer}}}} or {{{{c1::answer::hint}}}}.\n\
        - Use multiple cloze numbers (c1, c2, c3...) for multiple deletions in one sentence.\n\
        - Put the cloze text in 'front'. Use 'back' for optional extra context.\n\
        - Output ONLY valid JSON: an array of objects with 'front' and 'back' string fields.\n\
        - No markdown code fences. No prose. No explanation. Just raw JSON.\n\
        - Do not include any text before or after the JSON array."
    )
} else {
    format!(
        "Generate exactly {n} high-quality flashcards for spaced repetition about the following topic.\n\n\
        Topic: {topic}\n\n\
        Rules:\n\
        - Each card has a concise 'front' (question/prompt) and a clear 'back' (answer/explanation).\n\
        - Front should be atomic — test one concept per card.\n\
        - Back should be accurate and self-contained.\n\
        - Output ONLY valid JSON: an array of objects with 'front' and 'back' string fields.\n\
        - No markdown code fences. No prose. No explanation. Just raw JSON.\n\
        - Do not include any text before or after the JSON array."
    )
};
```

- [ ] **Step 2: Update GeneratePage.svelte**

Add cloze toggle state (after line 10):

```typescript
let clozeMode = $state(false);
```

Update the `generate` function's invoke call (line 20):

```typescript
const result = await invoke<{ front: string; back: string }[]>('generate_cards', {
  topic: prompt,
  count: cardCount,
  cloze: clozeMode,
});
```

Update `addSelected` to pass note type (replace lines 36-41):

```typescript
function addSelected() {
  if (!selectedDeckId) return;
  const toAdd = generatedCards.filter(c => c.selected).map(c => ({ front: c.front, back: c.back }));
  addCardsBulk(selectedDeckId, toAdd, ['ai-generated'], clozeMode ? 'cloze' : 'basic');
  generatedCards = [];
  prompt = '';
}
```

Update imports (line 2):

```typescript
import { decks, addCardsBulk } from '../stores/data';
```

Add the toggle UI in the controls section (after the count input, before the generate button, around line 74):

```svelte
<div class="gen-deck-select">
  <label for="gen-cloze">Format</label>
  <button
    id="gen-cloze"
    class="cloze-toggle"
    class:active={clozeMode}
    onclick={() => clozeMode = !clozeMode}
  >
    {clozeMode ? 'Cloze' : 'Basic'}
  </button>
</div>
```

Add CSS for the toggle:

```css
.cloze-toggle {
  padding: var(--sp-sm) var(--sp-md);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--dur-micro) var(--ease);
}

.cloze-toggle:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.cloze-toggle.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd ~/anki-rewrite/src-tauri && cargo check && cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd ~/anki-rewrite
git add src-tauri/src/lib.rs src/lib/pages/GeneratePage.svelte
git commit -m "feat: add cloze mode toggle to AI card generation"
```

---

### Task 10: Query Language — note_type and has:cloze

**Files:**
- Modify: `src/lib/query.ts`

- [ ] **Step 1: Add note_type and has:cloze predicates**

In `src/lib/query.ts`, update the imports (line 63):

```typescript
import type { Card, Deck, Note } from './stores/data';
```

Update the `QueryContext` interface to include notes:

```typescript
export interface QueryContext {
  decks: Deck[];
  notes: Note[];
  now: number;
  currentDeckId?: string | null;
}
```

Add new cases in the `switch (field)` block inside `buildFieldPredicate` (before the `default:` case at line 353):

```typescript
case 'note-type':
case 'note_type': {
  const val = lower;
  if (val !== 'basic' && val !== 'cloze') return failPred(`note_type must be "basic" or "cloze", got "${value}"`);
  return (c, ctx) => {
    const note = ctx.notes.find(n => n.id === c.noteId);
    return note?.noteType === val;
  };
}

case 'has': {
  if (lower === 'cloze') {
    return (c, ctx) => {
      const note = ctx.notes.find(n => n.id === c.noteId);
      return note?.noteType === 'cloze';
    };
  }
  return failPred(`Unknown has: value "${value}"`);
}
```

- [ ] **Step 2: Update BrowsePage to pass notes in QueryContext**

In `src/lib/pages/BrowsePage.svelte`, update the filtered derived (line 15):

```typescript
const filtered = $derived(
  parsed.matches($cards, { decks: $decks, notes: $notes, now: Date.now(), currentDeckId: $activeDeckId })
);
```

Add `notes` to the import from data store if not already done.

- [ ] **Step 3: Update search help panel**

In BrowsePage.svelte, add to the help panel field list (around line 100):

```svelte
<li><code>note_type:</code><i>basic|cloze</i> — note type</li>
<li><code>has:cloze</code> — cloze cards only</li>
```

Add a cloze search example to the examples array (around line 153):

```typescript
'has:cloze',
```

- [ ] **Step 4: Verify compilation**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/query.ts src/lib/pages/BrowsePage.svelte
git commit -m "feat: add note_type: and has:cloze search predicates"
```

---

### Task 11: stripMarkdown — Handle Cloze Markers

**Files:**
- Modify: `src/lib/markdown.ts`
- Test: `src/lib/cloze.test.ts` (append)

- [ ] **Step 1: Add test for stripMarkdown with cloze**

Append to `src/lib/cloze.test.ts`:

```typescript
import { stripMarkdown } from './markdown';

describe('stripMarkdown with cloze', () => {
  it('strips cloze markers showing answer text', () => {
    expect(stripMarkdown('{{c1::Paris}} is in {{c2::France}}')).toBe('Paris is in France');
  });

  it('strips cloze with hint showing answer not hint', () => {
    expect(stripMarkdown('{{c1::Paris::a city}}')).toBe('Paris');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/cloze.test.ts`
Expected: FAIL — cloze markers left in output

- [ ] **Step 3: Add cloze stripping to stripMarkdown**

In `src/lib/markdown.ts`, add a cloze strip step at the beginning of `stripMarkdown` (after `let s = src;` on line 245):

```typescript
// Strip cloze markers → answer text
s = s.replace(/\{\{c\d+::([^}]*?)(?:::[^}]*?)?\}\}/g, '$1');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/anki-rewrite && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/markdown.ts src/lib/cloze.test.ts
git commit -m "feat: strip cloze markers in markdown preview text"
```

---

### Task 12: Run Full Test Suite & Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all Rust tests**

Run: `cd ~/anki-rewrite/src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 2: Run all TypeScript tests**

Run: `cd ~/anki-rewrite && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run TypeScript type check**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Start dev server and smoke test**

Run: `cd ~/anki-rewrite && npm run tauri:dev`

Manual checks:
- App launches without errors
- Existing demo cards still display correctly in Review
- Browse page shows "Type" column with "Basic" for all existing cards
- Search `has:cloze` returns 0 results (no cloze cards yet)
- Generate page shows Basic/Cloze toggle
- Toggle to Cloze mode, generate cards → cards contain `{{c1::...}}` syntax
- Add generated cloze cards → appear in Browse with "Cloze" type badge
- Review cloze cards → blanked text on front, highlighted answer after flip
- Edit cloze note in Browse → adding/removing `{{cN::}}` updates card count

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
cd ~/anki-rewrite
git add -A
git commit -m "fix: address issues found during cloze smoke test"
```
