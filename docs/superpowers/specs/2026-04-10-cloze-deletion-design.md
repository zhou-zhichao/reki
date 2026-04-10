# Cloze Deletion — Design Spec

## Overview

Add Anki-style cloze deletion to Reki. A cloze note like `"法国首都是 {{c1::巴黎::提示}}, 位于 {{c2::欧洲}}"` automatically produces 2 independently scheduled cards — one testing c1, one testing c2.

This requires introducing a **Note layer** (note → card one-to-many) and unifying all existing cards under it.

## Syntax

Cloze markers follow Anki's format:

```
{{c<N>::<answer>}}           — basic cloze
{{c<N>::<answer>::<hint>}}   — cloze with hint
```

- `N` is a positive integer (1-indexed, no upper limit)
- `answer` is the hidden text (can contain markdown, math, etc.)
- `hint` (optional) is displayed in place of the blank during review
- Gaps in numbering are allowed (c1, c3 → 2 cards, ordinals 1 and 3)

Regex: `\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}`

## Data Model

### New: `notes` table

```sql
CREATE TABLE notes (
    id         TEXT PRIMARY KEY,
    deck_id    TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    note_type  TEXT NOT NULL DEFAULT 'basic',  -- 'basic' | 'cloze'
    front      TEXT NOT NULL DEFAULT '',
    back       TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',      -- JSON array
    created_at INTEGER NOT NULL,
    edited_at  INTEGER NOT NULL
);
```

- `basic` notes: `front` = question, `back` = answer. Generates 1 card.
- `cloze` notes: `front` = text with `{{cN::...}}` markers, `back` = optional extra context shown after flip. Generates N cards (one per distinct cloze number).

### Modified: `cards` table

Add columns:

```sql
note_id  TEXT REFERENCES notes(id) ON DELETE CASCADE,
ordinal  INTEGER NOT NULL DEFAULT 0
```

- `note_id`: links card to its parent note.
- `ordinal`: for basic notes, always 0. For cloze notes, equals the cloze number (c1 → 1, c2 → 2, etc.).

Existing columns (`front`, `back`, `stability`, `difficulty`, `interval`, `due`, `reps`, `lapses`, `state`, `ease`, `tags`, `flag`, `position`, `created_at`, `edited_at`) remain unchanged.

For basic cards, `front`/`back` are copied from the note. For cloze cards, `front`/`back` are derived at render time from the note content + ordinal, but we still store a snapshot in the card row for search/preview (updated when note is edited).

### Migration (v2)

1. Create `notes` table.
2. Add `note_id` and `ordinal` columns to `cards` (nullable initially).
3. For each existing card: create a `basic` note with matching `front`, `back`, `deck_id`, `tags`, `created_at`, `edited_at`. Set card's `note_id` to the new note id, `ordinal` to 0.
4. Make `note_id` NOT NULL.
5. Move `tags` authority to notes (cards inherit from their note).

## Cloze Parsing Module

New file: `src/lib/cloze.ts`

### Functions

```typescript
// Parse all cloze markers from text
parseClozes(text: string): Cloze[]
// where Cloze = { num: number; answer: string; hint?: string; start: number; end: number }

// Get sorted unique cloze numbers
extractClozeNumbers(text: string): number[]

// Render text for a specific ordinal:
// - Active cloze (matching ordinal): replaced with blank/hint span
// - Other clozes: display answer text inline (no marker syntax)
renderClozeFront(text: string, ordinal: number): string

// Render text with answer revealed:
// - Active cloze: wrapped in highlight span showing answer
// - Other clozes: display answer text inline
renderClozeBack(text: string, ordinal: number): string

// Check if text contains any cloze markers
hasCloze(text: string): boolean
```

### Rendering Rules

Given `"法国首都是 {{c1::巴黎::欧洲国家}}, 位于 {{c2::欧洲}}"`:

**Card for c1 (ordinal=1):**
- Front: `"法国首都是 <span class="cloze-blank">[欧洲国家]</span>, 位于 欧洲"`
- Back: `"法国首都是 <span class="cloze-answer">巴黎</span>, 位于 欧洲"`

**Card for c2 (ordinal=2):**
- Front: `"法国首都是 巴黎, 位于 <span class="cloze-blank">[...]</span>"`
- Back: `"法国首都是 巴黎, 位于 <span class="cloze-answer">欧洲</span>"`

Without hint, blank shows `[...]`.

## Markdown Integration

### Pipeline Change (markdown.ts)

Cloze preprocessing runs **before** `marked()`:

```
Input text + ordinal
    ↓
renderClozeFont/Back (cloze.ts)  ← NEW step
    ↓
marked + KaTeX extensions
    ↓
Shiki code highlighting
    ↓
DOMPurify sanitization
    ↓
HTML output
```

New function:

```typescript
renderMarkdownCloze(src: string, ordinal: number, revealed: boolean): Promise<string>
```

The existing `renderMarkdown(src)` remains unchanged for basic cards.

### DOMPurify

Add `cloze-blank` and `cloze-answer` class names to allowed attributes — already covered by existing `class` allowance. No changes needed.

## Review Page Changes (ReviewPage.svelte)

### Card Display

The review page needs to know whether the current card is a cloze card and its ordinal. This info comes from the card's `note_id` and `ordinal` fields.

- **Basic card**: current behavior (show front, flip to show back).
- **Cloze card**:
  - Before flip: render note's `front` through `renderMarkdownCloze(text, ordinal, false)` — active cloze is blanked, others shown.
  - After flip: render note's `front` through `renderMarkdownCloze(text, ordinal, true)` — active cloze highlighted with answer, others shown. If note has `back` content (extra context), show it below.

Flip/rating mechanics remain identical.

### Visual Styling

```css
.cloze-blank {
    /* Visible gap indicator */
    background: var(--cloze-blank-bg);
    color: var(--cloze-blank-color);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-style: italic;
}

.cloze-answer {
    /* Revealed answer highlight */
    background: var(--cloze-answer-bg);
    color: var(--cloze-answer-color);
    padding: 0.1em 0.4em;
    border-radius: 3px;
    font-weight: 600;
}
```

Colors defined per theme in CSS variables.

## Data Layer Changes (data.ts)

### New Functions

```typescript
// Create a note + its cards
addNote(deckId: string, type: 'basic' | 'cloze', front: string, back: string, tags?: string[]): Note

// Update note content, sync cards
// - basic: update the single card's front/back
// - cloze: diff cloze numbers, add new cards (state: 'new'), remove cards for deleted cloze numbers, update remaining cards' front/back snapshots
updateNote(noteId: string, changes: { front?: string; back?: string; tags?: string[] }): void

// Delete note + cascade delete cards
deleteNote(noteId: string): void
```

### Existing Functions

- `addCard` / `updateCard` / `deleteCard`: still work for direct card manipulation (scheduling, flags, state). Card content edits go through `updateNote`.
- `addCardsBulk`: used by AI generation — updated to call `addNote` internally.

### Stores

- `notes` writable store (parallel to `cards`).
- `dueCards` derived store: unchanged, still returns cards. The card now carries `noteId` and `ordinal` for rendering.

## Browse Page Changes (BrowsePage.svelte)

### Table View

- Add "Type" column showing `Basic` or `Cloze`.
- For cloze cards, the "Front" preview shows the raw cloze text with markers visible (not rendered).
- Clicking a cloze card selects its parent note for editing.

### Detail Panel

- Edit the **note**, not individual cards.
- For cloze notes: single text editor for `front` (with cloze markers), optional `back` (extra context).
- Show card count: "This note generates N cards".
- Save triggers `updateNote` which syncs all child cards.

## Query Extensions (query.ts)

New predicates:

- `note_type:basic` / `note_type:cloze` — filter by note type.
- `has:cloze` — alias for `note_type:cloze`.

Implementation: add to `buildFieldPredicate` in query.ts. The card object carries `noteType` (denormalized or via note lookup).

## AI Generation Changes

### Rust (lib.rs)

Add `cloze` parameter to `generate_cards`:

```rust
#[tauri::command]
async fn generate_cards(
    app: tauri::AppHandle,
    topic: String,
    count: Option<u32>,
    cloze: Option<bool>,  // NEW
) -> Result<Vec<GeneratedCard>, String>
```

When `cloze: true`, adjust the prompt:

```
Generate spaced repetition cards using cloze deletion format.
Use {{c1::answer}} syntax to mark deletions. Use multiple cloze numbers
(c1, c2, c3...) for multiple deletions in the same sentence.
Optionally add hints: {{c1::answer::hint}}.
Put the cloze text in "front". Use "back" for optional extra context.
```

### Frontend (GeneratePage.svelte)

- Add toggle: "Generate as cloze cards".
- When enabled, pass `cloze: true` to Tauri command.
- Generated cards processed through `addNote` with type `cloze`.

## Rust Backend Changes (db.rs)

### New Commands

```rust
#[tauri::command]
fn db_save_note(note: Note) -> Result<(), String>

#[tauri::command]
fn db_get_notes(deck_id: Option<String>) -> Result<Vec<Note>, String>

#[tauri::command]
fn db_delete_note(note_id: String) -> Result<(), String>
```

### Modified Commands

- `db_save_card`: add `note_id`, `ordinal` fields.
- `db_get_cards`: join with notes to include `note_type` in response (or denormalize into card struct).

### Note Struct

```rust
pub struct Note {
    pub id: String,
    pub deck_id: String,
    pub note_type: String,  // "basic" | "cloze"
    pub front: String,
    pub back: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub edited_at: i64,
}
```

## Testing

### Rust Tests (db.rs)

- Migration v2: existing cards get notes, `note_id` populated.
- CRUD for notes table.
- Cascade delete: deleting note deletes child cards.
- Cascade delete: deleting deck deletes notes and cards.

### TypeScript Tests

**cloze.ts:**
- `parseClozes`: single cloze, multiple clozes, with hint, nested markdown/math in answer.
- `extractClozeNumbers`: gaps in numbering, duplicates.
- `renderClozeFont`: correct blank/hint for active ordinal, other clozes shown.
- `renderClozeBack`: correct highlight for active ordinal.
- `hasCloze`: positive and negative cases.
- Edge cases: empty answer `{{c1::}}`, cloze inside code block (should NOT be parsed), cloze inside math (should NOT be parsed).

**Integration:**
- `renderMarkdownCloze`: cloze + markdown + KaTeX renders correctly.
- Browse page: editing cloze note updates card count.

### Manual E2E

- Create cloze note → correct number of cards generated.
- Review cloze card → blank shown, flip reveals answer with highlight.
- Edit cloze note (add/remove cloze) → cards added/removed, existing scheduling preserved.
- AI generate in cloze mode → valid cloze cards created.
- Search `note_type:cloze` → returns only cloze cards.
- Delete cloze note → all child cards removed.

## Edge Cases

- **Cloze inside code block**: `` `{{c1::not a cloze}}` `` — must NOT be parsed as cloze. Detect by checking if marker is inside backticks or fenced code block.
- **Cloze inside math**: `${{c1::x^2}}$` — must NOT be parsed. Detect by checking if inside `$...$` or `$$...$$`.
- **Empty cloze**: `{{c1::}}` — valid, shows `[...]` as blank with empty answer.
- **Single cloze number used multiple times**: `{{c1::A}} and {{c1::B}}` — produces 1 card where both are blanked simultaneously. Same as Anki behavior.
- **Editing reduces cloze count**: If a note had c1, c2, c3 and user removes c3, the card for c3 is deleted. Cards for c1, c2 retain scheduling history.
- **Editing increases cloze count**: New card created with `state: 'new'`.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/db.rs` | notes table, migration v2, note CRUD commands, card schema update |
| `src-tauri/src/lib.rs` | register new commands, cloze param for AI generation |
| `src/lib/cloze.ts` | **NEW** — cloze parsing, rendering, detection |
| `src/lib/markdown.ts` | add `renderMarkdownCloze` function |
| `src/lib/stores/data.ts` | Note store, `addNote`/`updateNote`/`deleteNote`, update `addCardsBulk` |
| `src/lib/pages/ReviewPage.svelte` | cloze-aware rendering (front blank, back highlight) |
| `src/lib/pages/BrowsePage.svelte` | edit notes instead of cards, type column |
| `src/lib/pages/GeneratePage.svelte` | cloze mode toggle |
| `src/lib/query.ts` | `note_type:` and `has:cloze` predicates |
| `src/lib/components/Markdown.svelte` | accept optional `ordinal` + `revealed` props |
| CSS (global or component) | `.cloze-blank`, `.cloze-answer` styles per theme |
