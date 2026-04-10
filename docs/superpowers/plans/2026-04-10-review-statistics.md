# Review Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Anki-style statistics page with review logging, 6 chart modules, deck/time range filtering, and pure SVG charts.

**Architecture:** New `review_log` table records every card rating. A Stats page with SVG chart components reads from both the card snapshot (in-memory) and aggregated review log data (Rust query). Stats store manages scope/range reactively.

**Tech Stack:** Rust/SQLite (review_log table + aggregation query), Svelte 5/TypeScript (Stats page + SVG chart components), vitest (TS tests), cargo test (Rust tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/db.rs` | Modify | review_log table, migration v3, log_review, get_review_stats |
| `src-tauri/src/lib.rs` | Modify | Register new commands |
| `src/lib/stores/data.ts` | Modify | Log review in applyFsrsChoice |
| `src/lib/stores/stats.ts` | Create | Stats store (range, scope, reviewStats, derived card stats) |
| `src/lib/stores/router.ts` | Modify | Add 'stats' route |
| `src/lib/components/Sidebar.svelte` | Modify | Add Stats nav item |
| `src/lib/components/charts/BarChart.svelte` | Create | Reusable SVG bar chart |
| `src/lib/components/charts/DonutChart.svelte` | Create | SVG donut chart |
| `src/lib/components/charts/StatCard.svelte` | Create | Single metric display |
| `src/lib/pages/StatsPage.svelte` | Create | Statistics page |
| `src/lib/stats.ts` | Create | Pure functions for card stat derivation |
| `src/lib/stats.test.ts` | Create | Tests for stat derivation functions |
| `src/App.svelte` | Modify | Add StatsPage route |

---

### Task 1: Rust Backend — review_log Table & Commands

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/db.rs`:

```rust
#[test]
fn migration_v3_creates_review_log_table() {
    let conn = test_conn();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='review_log'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn log_review_and_get_stats() {
    let conn = test_conn();
    upsert_deck(&conn, &Deck { id: "d1".into(), name: "Test".into(), created_at: 0 }).unwrap();
    let note = Note {
        id: "n1".into(), deck_id: "d1".into(), note_type: "basic".into(),
        front: "f".into(), back: "b".into(), tags: vec![], created_at: 0, edited_at: 0,
    };
    upsert_note(&conn, &note).unwrap();
    let card = Card {
        id: "c1".into(), deck_id: "d1".into(), note_id: "n1".into(), ordinal: 0,
        front: "f".into(), back: "b".into(),
        stability: None, difficulty: None, last_review: None,
        interval: 0, due: 0, reps: 0, lapses: 0, state: "new".into(), ease: 2.5,
        tags: vec![], created_at: 0, edited_at: 0, flag: 0, position: 0,
    };
    upsert_card(&conn, &card).unwrap();

    let log = ReviewLog {
        card_id: "c1".into(),
        deck_id: "d1".into(),
        rating: "good".into(),
        elapsed_days: 0,
        new_stability: Some(3.5),
        new_difficulty: Some(5.0),
        new_interval: 1,
        reviewed_at: 1712700000000, // fixed timestamp
    };
    insert_review_log(&conn, &log).unwrap();

    let stats = get_review_stats(&conn, None, None).unwrap();
    assert_eq!(stats.today_count, 0); // timestamp is in the past
    assert_eq!(stats.daily_counts.len(), 1);
    assert_eq!(stats.daily_counts[0].good, 1);
}

#[test]
fn review_log_deck_filter() {
    let conn = test_conn();
    upsert_deck(&conn, &Deck { id: "d1".into(), name: "A".into(), created_at: 0 }).unwrap();
    upsert_deck(&conn, &Deck { id: "d2".into(), name: "B".into(), created_at: 0 }).unwrap();
    let note1 = Note {
        id: "n1".into(), deck_id: "d1".into(), note_type: "basic".into(),
        front: "f".into(), back: "b".into(), tags: vec![], created_at: 0, edited_at: 0,
    };
    let note2 = Note {
        id: "n2".into(), deck_id: "d2".into(), note_type: "basic".into(),
        front: "f".into(), back: "b".into(), tags: vec![], created_at: 0, edited_at: 0,
    };
    upsert_note(&conn, &note1).unwrap();
    upsert_note(&conn, &note2).unwrap();
    let card1 = Card {
        id: "c1".into(), deck_id: "d1".into(), note_id: "n1".into(), ordinal: 0,
        front: "f".into(), back: "b".into(),
        stability: None, difficulty: None, last_review: None,
        interval: 0, due: 0, reps: 0, lapses: 0, state: "new".into(), ease: 2.5,
        tags: vec![], created_at: 0, edited_at: 0, flag: 0, position: 0,
    };
    let card2 = Card {
        id: "c2".into(), deck_id: "d2".into(), note_id: "n2".into(), ordinal: 0,
        front: "f".into(), back: "b".into(),
        stability: None, difficulty: None, last_review: None,
        interval: 0, due: 0, reps: 0, lapses: 0, state: "new".into(), ease: 2.5,
        tags: vec![], created_at: 0, edited_at: 0, flag: 0, position: 0,
    };
    upsert_card(&conn, &card1).unwrap();
    upsert_card(&conn, &card2).unwrap();

    let now = chrono_today_epoch_ms();
    insert_review_log(&conn, &ReviewLog {
        card_id: "c1".into(), deck_id: "d1".into(), rating: "good".into(),
        elapsed_days: 0, new_stability: None, new_difficulty: None,
        new_interval: 1, reviewed_at: now,
    }).unwrap();
    insert_review_log(&conn, &ReviewLog {
        card_id: "c2".into(), deck_id: "d2".into(), rating: "easy".into(),
        elapsed_days: 0, new_stability: None, new_difficulty: None,
        new_interval: 1, reviewed_at: now,
    }).unwrap();

    let stats_d1 = get_review_stats(&conn, Some("d1"), None).unwrap();
    assert_eq!(stats_d1.today_count, 1);
    assert_eq!(stats_d1.today_correct, 1);

    let stats_all = get_review_stats(&conn, None, None).unwrap();
    assert_eq!(stats_all.today_count, 2);
}

fn chrono_today_epoch_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/anki-rewrite/src-tauri && cargo test`
Expected: FAIL — `ReviewLog` not found, `insert_review_log` not found

- [ ] **Step 3: Add ReviewLog struct and migration v3**

In `src-tauri/src/db.rs`, add after the Note struct:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLog {
    pub card_id: String,
    pub deck_id: String,
    pub rating: String,
    pub elapsed_days: i64,
    pub new_stability: Option<f32>,
    pub new_difficulty: Option<f32>,
    pub new_interval: i64,
    pub reviewed_at: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStats {
    pub daily_counts: Vec<DayCount>,
    pub today_count: i64,
    pub today_again: i64,
    pub today_correct: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub date: String,
    pub total: i64,
    pub again: i64,
    pub hard: i64,
    pub good: i64,
    pub easy: i64,
}
```

Add migration v3 after `set_version(conn, 2)?;` (inside the `migrate` function):

```rust
if v < 3 {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS review_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id         TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            deck_id         TEXT NOT NULL,
            rating          TEXT NOT NULL,
            elapsed_days    INTEGER NOT NULL,
            new_stability   REAL,
            new_difficulty  REAL,
            new_interval    INTEGER NOT NULL,
            reviewed_at     INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS review_log_card_id ON review_log(card_id);
        CREATE INDEX IF NOT EXISTS review_log_reviewed_at ON review_log(reviewed_at);
        CREATE INDEX IF NOT EXISTS review_log_deck_id ON review_log(deck_id);
        "#,
    )?;
    set_version(conn, 3)?;
}
```

- [ ] **Step 4: Add insert_review_log and get_review_stats functions**

```rust
pub fn insert_review_log(conn: &Connection, log: &ReviewLog) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO review_log (card_id, deck_id, rating, elapsed_days, new_stability, new_difficulty, new_interval, reviewed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            log.card_id, log.deck_id, log.rating, log.elapsed_days,
            log.new_stability, log.new_difficulty, log.new_interval, log.reviewed_at,
        ],
    )?;
    Ok(())
}

pub fn get_review_stats(
    conn: &Connection,
    deck_id: Option<&str>,
    since: Option<i64>,
) -> rusqlite::Result<ReviewStats> {
    // Today boundaries (midnight to midnight in local time, approximated with UTC)
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let today_start = now_ms - (now_ms % 86_400_000);

    // Build WHERE clause
    let mut conditions = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(did) = deck_id {
        conditions.push(format!("deck_id = ?{param_idx}"));
        param_values.push(Box::new(did.to_string()));
        param_idx += 1;
    }
    if let Some(s) = since {
        conditions.push(format!("reviewed_at >= ?{param_idx}"));
        param_values.push(Box::new(s));
        param_idx += 1;
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // Today stats
    let today_where = if conditions.is_empty() {
        format!("WHERE reviewed_at >= ?{param_idx}")
    } else {
        format!("{where_clause} AND reviewed_at >= ?{param_idx}")
    };

    let mut today_params: Vec<Box<dyn rusqlite::types::ToSql>> = param_values.iter()
        .map(|p| -> Box<dyn rusqlite::types::ToSql> {
            // Re-box — we need fresh param vecs for each query
            // This is a workaround; we'll use a simpler approach below
            unreachable!()
        })
        .collect();
    // Simpler approach: build queries with string interpolation for the fixed parts

    // --- Today stats ---
    let today_count: i64;
    let today_again: i64;
    let today_correct: i64;

    match deck_id {
        Some(did) => {
            today_count = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE deck_id = ?1 AND reviewed_at >= ?2",
                params![did, today_start], |r| r.get(0),
            )?;
            today_again = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE deck_id = ?1 AND reviewed_at >= ?2 AND rating = 'again'",
                params![did, today_start], |r| r.get(0),
            )?;
            today_correct = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE deck_id = ?1 AND reviewed_at >= ?2 AND (rating = 'good' OR rating = 'easy')",
                params![did, today_start], |r| r.get(0),
            )?;
        }
        None => {
            today_count = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE reviewed_at >= ?1",
                params![today_start], |r| r.get(0),
            )?;
            today_again = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE reviewed_at >= ?1 AND rating = 'again'",
                params![today_start], |r| r.get(0),
            )?;
            today_correct = conn.query_row(
                "SELECT COUNT(*) FROM review_log WHERE reviewed_at >= ?1 AND (rating = 'good' OR rating = 'easy')",
                params![today_start], |r| r.get(0),
            )?;
        }
    }

    // --- Daily counts ---
    let daily_query = match (deck_id, since) {
        (Some(did), Some(s)) => {
            let mut stmt = conn.prepare(
                "SELECT date(reviewed_at / 1000, 'unixepoch') as d,
                        COUNT(*) as total,
                        SUM(CASE WHEN rating = 'again' THEN 1 ELSE 0 END) as again_c,
                        SUM(CASE WHEN rating = 'hard' THEN 1 ELSE 0 END) as hard_c,
                        SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END) as good_c,
                        SUM(CASE WHEN rating = 'easy' THEN 1 ELSE 0 END) as easy_c
                 FROM review_log WHERE deck_id = ?1 AND reviewed_at >= ?2
                 GROUP BY d ORDER BY d ASC"
            )?;
            let rows = stmt.query_map(params![did, s], |r| {
                Ok(DayCount {
                    date: r.get(0)?, total: r.get(1)?,
                    again: r.get(2)?, hard: r.get(3)?,
                    good: r.get(4)?, easy: r.get(5)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
            rows
        }
        (Some(did), None) => {
            let mut stmt = conn.prepare(
                "SELECT date(reviewed_at / 1000, 'unixepoch') as d,
                        COUNT(*) as total,
                        SUM(CASE WHEN rating = 'again' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'hard' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'easy' THEN 1 ELSE 0 END)
                 FROM review_log WHERE deck_id = ?1
                 GROUP BY d ORDER BY d ASC"
            )?;
            let rows = stmt.query_map(params![did], |r| {
                Ok(DayCount {
                    date: r.get(0)?, total: r.get(1)?,
                    again: r.get(2)?, hard: r.get(3)?,
                    good: r.get(4)?, easy: r.get(5)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
            rows
        }
        (None, Some(s)) => {
            let mut stmt = conn.prepare(
                "SELECT date(reviewed_at / 1000, 'unixepoch') as d,
                        COUNT(*) as total,
                        SUM(CASE WHEN rating = 'again' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'hard' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'easy' THEN 1 ELSE 0 END)
                 FROM review_log WHERE reviewed_at >= ?1
                 GROUP BY d ORDER BY d ASC"
            )?;
            let rows = stmt.query_map(params![s], |r| {
                Ok(DayCount {
                    date: r.get(0)?, total: r.get(1)?,
                    again: r.get(2)?, hard: r.get(3)?,
                    good: r.get(4)?, easy: r.get(5)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
            rows
        }
        (None, None) => {
            let mut stmt = conn.prepare(
                "SELECT date(reviewed_at / 1000, 'unixepoch') as d,
                        COUNT(*) as total,
                        SUM(CASE WHEN rating = 'again' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'hard' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'good' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN rating = 'easy' THEN 1 ELSE 0 END)
                 FROM review_log
                 GROUP BY d ORDER BY d ASC"
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(DayCount {
                    date: r.get(0)?, total: r.get(1)?,
                    again: r.get(2)?, hard: r.get(3)?,
                    good: r.get(4)?, easy: r.get(5)?,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
            rows
        }
    };

    Ok(ReviewStats {
        daily_counts: daily_query,
        today_count,
        today_again,
        today_correct,
    })
}
```

Add Tauri commands:

```rust
#[tauri::command]
pub fn db_log_review(state: State<'_, DbState>, log: ReviewLog) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    insert_review_log(&conn, &log).map_err(db_err)
}

#[tauri::command]
pub fn db_get_review_stats(
    state: State<'_, DbState>,
    deck_id: Option<String>,
    since: Option<i64>,
) -> Result<ReviewStats, String> {
    let conn = state.lock().map_err(lock_err)?;
    get_review_stats(&conn, deck_id.as_deref(), since).map_err(db_err)
}
```

- [ ] **Step 5: Register commands in lib.rs**

In `src-tauri/src/lib.rs`, add to `generate_handler!`:

```rust
db::db_log_review,
db::db_get_review_stats,
```

- [ ] **Step 6: Run tests**

Run: `cd ~/anki-rewrite/src-tauri && cargo test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
cd ~/anki-rewrite
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: add review_log table, migration v3, log and stats commands"
```

---

### Task 2: Frontend — Log Reviews in applyFsrsChoice

**Files:**
- Modify: `src/lib/stores/data.ts:171-199`

- [ ] **Step 1: Add review log call to applyFsrsChoice**

In `src/lib/stores/data.ts`, in the `applyFsrsChoice` function, after the existing `if (updated) persist(invoke('db_save_card', ...))` line (line 198), add:

```typescript
if (updated) {
  persist(invoke('db_save_card', { card: updated }));
  const elapsed = updated.lastReview != null && c.lastReview != null
    ? Math.max(0, Math.floor((updated.lastReview - c.lastReview) / 86_400_000))
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
```

Note: You need to capture the old card state before the update to compute `elapsed`. Restructure `applyFsrsChoice` so the old `lastReview` is available:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/data.ts
git commit -m "feat: log review events in applyFsrsChoice"
```

---

### Task 3: Stats Derivation Module + Tests

**Files:**
- Create: `src/lib/stats.ts`
- Create: `src/lib/stats.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/stats.test.ts`:

```typescript
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
    expect(buckets.length).toBeGreaterThan(0);
    // new cards (interval 0) are excluded
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/stats.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement stats.ts**

Create `src/lib/stats.ts`:

```typescript
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
    day: i,
    young: 0,
    mature: 0,
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
```

- [ ] **Step 4: Run tests**

Run: `cd ~/anki-rewrite && npx vitest run src/lib/stats.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: add stats derivation module with tests"
```

---

### Task 4: Stats Store

**Files:**
- Create: `src/lib/stores/stats.ts`

- [ ] **Step 1: Create the stats store**

Create `src/lib/stores/stats.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/stats.ts
git commit -m "feat: add stats store with range/scope/review data"
```

---

### Task 5: SVG Chart Components

**Files:**
- Create: `src/lib/components/charts/StatCard.svelte`
- Create: `src/lib/components/charts/BarChart.svelte`
- Create: `src/lib/components/charts/DonutChart.svelte`

- [ ] **Step 1: Create StatCard.svelte**

Create `src/lib/components/charts/StatCard.svelte`:

```svelte
<script lang="ts">
  interface Props {
    label: string;
    value: string;
  }
  let { label, value }: Props = $props();
</script>

<div class="stat-card">
  <div class="stat-value">{value}</div>
  <div class="stat-label">{label}</div>
</div>

<style>
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-xs);
    padding: var(--sp-md) var(--sp-lg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    flex: 1;
    min-width: 100px;
  }

  .stat-value {
    font-family: 'Satoshi', sans-serif;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
  }

  .stat-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 500;
  }
</style>
```

- [ ] **Step 2: Create BarChart.svelte**

Create `src/lib/components/charts/BarChart.svelte`:

```svelte
<script lang="ts">
  interface BarSegment {
    value: number;
    color: string;
  }

  interface Bar {
    label: string;
    segments: BarSegment[];
  }

  interface Props {
    bars: Bar[];
    height?: number;
    stacked?: boolean;
  }

  let { bars, height = 200, stacked = false }: Props = $props();

  const maxValue = $derived(
    Math.max(1, ...bars.map(b =>
      stacked ? b.segments.reduce((s, seg) => s + seg.value, 0) : Math.max(...b.segments.map(seg => seg.value))
    ))
  );

  const barWidth = $derived(Math.max(2, Math.min(20, Math.floor(500 / Math.max(bars.length, 1)) - 2)));
  const chartWidth = $derived(bars.length * (barWidth + 2) + 40);
</script>

<div class="bar-chart-wrap">
  <svg
    viewBox="0 0 {chartWidth} {height + 30}"
    class="bar-chart"
    preserveAspectRatio="xMinYMin meet"
  >
    {#each bars as bar, i}
      {@const total = stacked ? bar.segments.reduce((s, seg) => s + seg.value, 0) : 0}
      {@const x = 30 + i * (barWidth + 2)}
      {#if stacked}
        {@const barH = (total / maxValue) * height}
        {#each bar.segments as seg, si}
          {@const segH = total > 0 ? (seg.value / total) * barH : 0}
          {@const prevH = bar.segments.slice(0, si).reduce((s, ps) => s + (total > 0 ? (ps.value / total) * barH : 0), 0)}
          <rect
            {x}
            y={height - prevH - segH}
            width={barWidth}
            height={Math.max(0, segH)}
            fill={seg.color}
            rx="1"
          >
            <title>{seg.value}</title>
          </rect>
        {/each}
      {:else}
        {#each bar.segments as seg}
          {@const barH = (seg.value / maxValue) * height}
          <rect
            {x}
            y={height - barH}
            width={barWidth}
            height={Math.max(0, barH)}
            fill={seg.color}
            rx="1"
          >
            <title>{bar.label}: {seg.value}</title>
          </rect>
        {/each}
      {/if}

      {#if i % Math.max(1, Math.floor(bars.length / 6)) === 0}
        <text
          x={x + barWidth / 2}
          y={height + 16}
          text-anchor="middle"
          class="axis-label"
        >{bar.label}</text>
      {/if}
    {/each}

    <!-- Y-axis line -->
    <line x1="28" y1="0" x2="28" y2={height} stroke="var(--border)" stroke-width="1" />
    <!-- X-axis line -->
    <line x1="28" y1={height} x2={chartWidth} y2={height} stroke="var(--border)" stroke-width="1" />

    <!-- Y-axis labels -->
    <text x="24" y="10" text-anchor="end" class="axis-label">{maxValue}</text>
    <text x="24" y={height} text-anchor="end" class="axis-label">0</text>
  </svg>
</div>

<style>
  .bar-chart-wrap {
    width: 100%;
    overflow-x: auto;
  }

  .bar-chart {
    width: 100%;
    max-height: 240px;
  }

  .axis-label {
    font-size: 9px;
    fill: var(--text-muted);
    font-family: 'Geist Mono', monospace;
  }
</style>
```

- [ ] **Step 3: Create DonutChart.svelte**

Create `src/lib/components/charts/DonutChart.svelte`:

```svelte
<script lang="ts">
  interface Segment {
    label: string;
    value: number;
    color: string;
  }

  interface Props {
    segments: Segment[];
    centerLabel?: string;
    size?: number;
  }

  let { segments, centerLabel, size = 180 }: Props = $props();

  const total = $derived(segments.reduce((s, seg) => s + seg.value, 0));
  const radius = size / 2 - 10;
  const strokeWidth = 24;
  const innerRadius = radius - strokeWidth;
  const circumference = 2 * Math.PI * radius;

  const arcs = $derived(() => {
    let offset = 0;
    return segments.map(seg => {
      const pct = total > 0 ? seg.value / total : 0;
      const dashLen = pct * circumference;
      const dashOffset = -offset;
      offset += dashLen;
      return { ...seg, dashLen, dashOffset, pct };
    });
  });
</script>

<div class="donut-wrap">
  <svg viewBox="0 0 {size} {size}" width={size} height={size}>
    {#each arcs() as arc}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={arc.color}
        stroke-width={strokeWidth}
        stroke-dasharray="{arc.dashLen} {circumference - arc.dashLen}"
        stroke-dashoffset={arc.dashOffset}
        transform="rotate(-90 {size / 2} {size / 2})"
      >
        <title>{arc.label}: {arc.value} ({(arc.pct * 100).toFixed(1)}%)</title>
      </circle>
    {/each}

    {#if centerLabel}
      <text x={size / 2} y={size / 2} text-anchor="middle" dominant-baseline="central" class="center-text">
        {centerLabel}
      </text>
    {/if}
  </svg>

  <div class="donut-legend">
    {#each segments as seg}
      {#if seg.value > 0}
        <div class="legend-item">
          <span class="legend-dot" style="background: {seg.color}"></span>
          <span class="legend-label">{seg.label}</span>
          <span class="legend-value">{seg.value}</span>
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .donut-wrap {
    display: flex;
    align-items: center;
    gap: var(--sp-lg);
  }

  .center-text {
    font-family: 'Satoshi', sans-serif;
    font-size: 24px;
    font-weight: 700;
    fill: var(--text-primary);
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-size: var(--text-sm);
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-label {
    color: var(--text-secondary);
    flex: 1;
  }

  .legend-value {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
</style>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/components/charts/
git commit -m "feat: add SVG chart components (StatCard, BarChart, DonutChart)"
```

---

### Task 6: Router + Sidebar + App.svelte

**Files:**
- Modify: `src/lib/stores/router.ts`
- Modify: `src/lib/components/Sidebar.svelte`
- Modify: `src/App.svelte`

- [ ] **Step 1: Add 'stats' to Route type**

In `src/lib/stores/router.ts`, update the Route type:

```typescript
export type Route = 'review' | 'decks' | 'browse' | 'generate' | 'stats' | 'settings';
```

- [ ] **Step 2: Add Stats to Sidebar navItems**

In `src/lib/components/Sidebar.svelte`, add stats after browse in the `navItems` array (line 11):

```typescript
const navItems: { id: Route; label: string; icon: string }[] = [
  { id: 'review', label: 'Review', icon: '◈' },
  { id: 'decks', label: 'Decks', icon: '▤' },
  { id: 'browse', label: 'Browse', icon: '⌕' },
  { id: 'stats', label: 'Stats', icon: '▦' },
  { id: 'generate', label: 'Generate', icon: '✦' },
];
```

- [ ] **Step 3: Add StatsPage route in App.svelte**

Import StatsPage and add the route block. In `src/App.svelte`:

Add import (after line 7):
```typescript
import StatsPage from './lib/pages/StatsPage.svelte';
```

Add route block (after the browse block, around line 34):
```svelte
{:else if $route === 'stats'}
  <StatsPage />
```

- [ ] **Step 4: Create a placeholder StatsPage.svelte**

Create `src/lib/pages/StatsPage.svelte` (placeholder to verify routing):

```svelte
<script lang="ts">
</script>

<div class="stats-page">
  <h2>Stats</h2>
  <p>Coming soon...</p>
</div>

<style>
  .stats-page {
    padding: var(--sp-lg);
  }
</style>
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd ~/anki-rewrite
git add src/lib/stores/router.ts src/lib/components/Sidebar.svelte src/App.svelte src/lib/pages/StatsPage.svelte
git commit -m "feat: add Stats route, sidebar nav item, placeholder page"
```

---

### Task 7: StatsPage — Full Implementation

**Files:**
- Modify: `src/lib/pages/StatsPage.svelte`

- [ ] **Step 1: Implement the full Stats page**

Replace `src/lib/pages/StatsPage.svelte` with:

```svelte
<script lang="ts">
  import { activeDeck, activeDeckId, decks } from '../stores/data';
  import {
    statsRange, statsScope, cardCounts, intervalBuckets, futureDue,
    reviewStats, fetchReviewStats, filteredCards,
  } from '../stores/stats';
  import type { StatsRange } from '../stats';
  import StatCard from '../components/charts/StatCard.svelte';
  import BarChart from '../components/charts/BarChart.svelte';
  import DonutChart from '../components/charts/DonutChart.svelte';

  const ranges: { value: StatsRange; label: string }[] = [
    { value: '1m', label: '1M' },
    { value: '3m', label: '3M' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
  ];

  // Fetch review stats when range/scope/deck changes
  $effect(() => {
    const range = $statsRange;
    const scope = $statsScope;
    const deckId = $activeDeckId;
    fetchReviewStats(range, scope, deckId);
  });

  // Today overview
  const todayCount = $derived($reviewStats?.todayCount ?? 0);
  const todayCorrect = $derived($reviewStats?.todayCorrect ?? 0);
  const todayAgain = $derived($reviewStats?.todayAgain ?? 0);
  const correctPct = $derived(
    todayCount > 0 ? ((todayCorrect / todayCount) * 100).toFixed(1) + '%' : '—'
  );

  const avgInterval = $derived(() => {
    const reviewCards = $filteredCards.filter(c => c.state === 'review');
    if (reviewCards.length === 0) return '—';
    const avg = reviewCards.reduce((s, c) => s + c.interval, 0) / reviewCards.length;
    return avg.toFixed(1) + 'd';
  });

  // Future due chart data
  const futureDueBars = $derived(
    $futureDue.map(d => ({
      label: d.day === 0 ? 'Today' : `+${d.day}`,
      segments: [
        { value: d.young, color: 'var(--accent)' },
        { value: d.mature, color: 'var(--text-muted)' },
      ],
    }))
  );

  // Calendar chart data (daily review counts)
  const calendarBars = $derived(
    ($reviewStats?.dailyCounts ?? []).map(d => ({
      label: d.date.slice(5), // "MM-DD"
      segments: [
        { value: d.again, color: 'var(--c-again)' },
        { value: d.hard, color: 'var(--c-hard)' },
        { value: d.good, color: 'var(--c-good)' },
        { value: d.easy, color: 'var(--c-easy)' },
      ],
    }))
  );

  // Interval histogram
  const intervalBars = $derived(
    $intervalBuckets.map(b => ({
      label: b.label,
      segments: [{ value: b.count, color: 'var(--accent)' }],
    }))
  );

  // Card counts donut
  const donutSegments = $derived([
    { label: 'New', value: $cardCounts.new, color: 'var(--accent)' },
    { label: 'Learning', value: $cardCounts.learning, color: 'var(--c-hard)' },
    { label: 'Young', value: $cardCounts.young, color: 'var(--c-good)' },
    { label: 'Mature', value: $cardCounts.mature, color: 'var(--text-muted)' },
    { label: 'Suspended', value: $cardCounts.suspended, color: 'var(--c-again)' },
  ]);

  // Answer buttons (percentage stacked)
  const answerBars = $derived(
    ($reviewStats?.dailyCounts ?? []).map(d => ({
      label: d.date.slice(5),
      segments: [
        { value: d.again, color: 'var(--c-again)' },
        { value: d.hard, color: 'var(--c-hard)' },
        { value: d.good, color: 'var(--c-good)' },
        { value: d.easy, color: 'var(--c-easy)' },
      ],
    }))
  );
</script>

<div class="stats-page">
  <header class="stats-header">
    <h2>Stats</h2>
    <div class="stats-controls">
      <div class="scope-toggle">
        <button
          class="toggle-btn"
          class:active={$statsScope === 'deck'}
          onclick={() => statsScope.set('deck')}
        >
          {$activeDeck?.name ?? 'No deck'}
        </button>
        <button
          class="toggle-btn"
          class:active={$statsScope === 'all'}
          onclick={() => statsScope.set('all')}
        >
          All Decks
        </button>
      </div>

      <div class="range-toggle">
        {#each ranges as r}
          <button
            class="range-btn"
            class:active={$statsRange === r.value}
            onclick={() => statsRange.set(r.value)}
          >
            {r.label}
          </button>
        {/each}
      </div>
    </div>
  </header>

  {#if $filteredCards.length === 0}
    <div class="empty-state">
      <div class="empty-icon">▦</div>
      <h3>No cards</h3>
      <p>Add cards to see statistics.</p>
    </div>
  {:else}
    <!-- Today Overview -->
    <section class="stats-section">
      <h3>Today</h3>
      <div class="stat-row">
        <StatCard label="Reviews" value={String(todayCount)} />
        <StatCard label="Correct" value={correctPct} />
        <StatCard label="Again" value={String(todayAgain)} />
        <StatCard label="Avg Interval" value={avgInterval()} />
      </div>
    </section>

    <!-- Future Due -->
    <section class="stats-section">
      <h3>Future Due</h3>
      {#if futureDueBars.some(b => b.segments.some(s => s.value > 0))}
        <BarChart bars={futureDueBars} stacked />
      {:else}
        <p class="no-data">No upcoming reviews</p>
      {/if}
    </section>

    <!-- Reviews Per Day -->
    <section class="stats-section">
      <h3>Reviews Per Day</h3>
      {#if calendarBars.length > 0}
        <BarChart bars={calendarBars} stacked />
      {:else}
        <p class="no-data">Start reviewing to see history</p>
      {/if}
    </section>

    <div class="stats-grid">
      <!-- Intervals -->
      <section class="stats-section">
        <h3>Intervals</h3>
        <BarChart bars={intervalBars} />
      </section>

      <!-- Card Counts -->
      <section class="stats-section">
        <h3>Card Counts</h3>
        <DonutChart segments={donutSegments} centerLabel={String($cardCounts.total)} />
      </section>
    </div>

    <!-- Answer Buttons -->
    <section class="stats-section">
      <h3>Answer Buttons</h3>
      {#if answerBars.length > 0}
        <BarChart bars={answerBars} stacked />
      {:else}
        <p class="no-data">Start reviewing to see rating distribution</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .stats-page {
    padding: var(--sp-lg);
    max-width: 900px;
    height: 100vh;
    overflow-y: auto;
  }

  .stats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-lg);
    gap: var(--sp-md);
  }

  .stats-header h2 {
    font-size: var(--text-xl);
    flex-shrink: 0;
  }

  .stats-controls {
    display: flex;
    gap: var(--sp-md);
  }

  .scope-toggle,
  .range-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
  }

  .toggle-btn,
  .range-btn {
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border-right: 1px solid var(--border);
    transition: all var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .toggle-btn:last-child,
  .range-btn:last-child {
    border-right: none;
  }

  .toggle-btn:hover,
  .range-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toggle-btn.active,
  .range-btn.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .stats-section {
    margin-bottom: var(--sp-xl);
  }

  .stats-section h3 {
    font-family: 'Satoshi', sans-serif;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--sp-md);
  }

  .stat-row {
    display: flex;
    gap: var(--sp-sm);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-lg);
  }

  .no-data {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-style: italic;
    padding: var(--sp-lg) 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-sm);
    padding: var(--sp-3xl) 0;
    color: var(--text-secondary);
  }

  .empty-icon {
    font-size: 3rem;
    color: var(--text-ghost);
    margin-bottom: var(--sp-sm);
  }

  .empty-state h3 {
    color: var(--text-primary);
    font-size: var(--text-xl);
  }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd ~/anki-rewrite && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/pages/StatsPage.svelte
git commit -m "feat: implement full Stats page with 6 chart modules"
```

---

### Task 8: Run Full Test Suite & Verify

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
- Sidebar shows "Stats" nav item between Browse and Generate
- Clicking Stats navigates to the Stats page
- Empty state shows when no reviews exist
- Today overview shows 0 reviews initially
- Future Due chart renders from card snapshot data
- Card Counts donut shows correct distribution
- Interval histogram displays correctly
- Review some cards → return to Stats → today count updates
- Calendar and Answer Buttons charts show data after reviewing
- Deck toggle switches between active deck and all decks
- Time range buttons (1M/3M/1Y/All) update review log charts
- All 3 themes render correctly
- Dark/light mode colors are legible on charts

- [ ] **Step 5: Commit any fixes**

```bash
cd ~/anki-rewrite
git add -A
git commit -m "fix: address issues found during stats smoke test"
```
