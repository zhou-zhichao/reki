# Review Statistics — Design Spec

## Overview

Add an Anki-style statistics page to Reki. A new "Stats" page in the sidebar shows review history, card distribution, and scheduling forecasts. Requires a new `review_log` table (migration v3) to record each review event.

## Scope

- New `review_log` table (Rust + SQLite)
- Log writes on each card rating
- New Stats page with 6 chart modules
- Scope toggle: active deck / all decks
- Time range selector: 1 month / 3 months / 1 year / all time
- Pure SVG charts (no chart library dependency)

## Data Model

### New: `review_log` table (migration v3)

```sql
CREATE TABLE review_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    deck_id     TEXT NOT NULL,
    rating      TEXT NOT NULL,          -- 'again' | 'hard' | 'good' | 'easy'
    elapsed_days INTEGER NOT NULL,      -- days since last review (0 for first)
    new_stability REAL,
    new_difficulty REAL,
    new_interval INTEGER NOT NULL,
    reviewed_at INTEGER NOT NULL        -- epoch ms timestamp
);

CREATE INDEX review_log_card_id ON review_log(card_id);
CREATE INDEX review_log_reviewed_at ON review_log(reviewed_at);
CREATE INDEX review_log_deck_id ON review_log(deck_id);
```

Each call to `applyFsrsChoice` writes one row. No existing data is affected — the table starts empty and accumulates from first use.

### Logging Trigger

In `data.ts`, `applyFsrsChoice` currently updates the card store and persists. After the card update, also invoke a new Tauri command `db_log_review` with:

```typescript
persist(invoke('db_log_review', {
  log: {
    cardId: id,
    deckId: card.deckId,
    rating,
    elapsedDays: elapsed,
    newStability: choice.stability,
    newDifficulty: choice.difficulty,
    newInterval: choice.interval,
    reviewedAt: Date.now(),
  }
}));
```

## Stats Page Layout

### Header Bar

```
Stats                    [Active Deck ▾ | All Decks]    [1M | 3M | 1Y | All]
```

- Deck toggle: switches between `activeDeckId` filtered and unfiltered
- Time range: filters `review_log` by `reviewed_at >= cutoff`

### Module 1: Today Overview

A horizontal row of key metrics (not a chart):

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│  Cards Today │   Correct %  │  Again Count │  Avg Interval│
│     42       │    88.1%     │      5       │    12.3d     │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

- **Cards Today**: count of `review_log` rows where `reviewed_at` is today
- **Correct %**: `(good + easy) / total * 100` for today's reviews
- **Again Count**: count of `rating = 'again'` today
- **Avg Interval**: mean `interval` across all non-new cards (from card snapshot, not log)

Data source: `review_log` for today + card snapshot for avg interval.

### Module 2: Future Due

Stacked bar chart: number of cards due each day for the next 30 days.

- X axis: days from now (0 = today, 1 = tomorrow, ... 29)
- Y axis: card count
- Stacks: young (interval < 21 days) vs mature (interval >= 21 days)
- Colors: young = accent, mature = muted

Data source: card snapshot — group cards by `Math.floor((due - now) / 86400000)`.

No `review_log` needed. Always 30 days regardless of time range selector.

### Module 3: Calendar (Reviews Per Day)

Bar chart: daily review count over the selected time range.

- X axis: dates
- Y axis: review count
- Bars colored by rating composition (stacked): again (red), hard (orange), good (green), easy (blue) — matching the existing rating colors `--c-again`, `--c-hard`, `--c-good`, `--c-easy`

Data source: `review_log` grouped by `date(reviewed_at)`.

### Module 4: Intervals

Histogram: distribution of card intervals.

- X axis: interval buckets (0-1d, 2-3d, 4-7d, 8-14d, 15-30d, 1-2mo, 2-3mo, 3-6mo, 6-12mo, 1y+)
- Y axis: card count
- Single color bars

Data source: card snapshot — group non-new cards by interval bucket.

### Module 5: Card Counts

Donut chart showing card state distribution:

- **New**: `state === 'new'`
- **Learning**: `state === 'learning'`
- **Young**: `state === 'review' && interval < 21`
- **Mature**: `state === 'review' && interval >= 21`
- **Suspended/Buried**: `state === 'suspended' || state === 'buried'`

Center text: total card count.

Data source: card snapshot.

### Module 6: Answer Buttons

Stacked bar chart: rating distribution per day over the selected time range.

- X axis: dates (same as Module 3)
- Y axis: percentage (0-100%)
- Stacks: again / hard / good / easy as percentage of daily total
- Colors: same as Module 3

Data source: `review_log` grouped by date, then by rating.

## Chart Rendering

### Approach: Pure SVG

No external chart library. Render charts as inline SVG elements within Svelte components.

Rationale:
- Reki has zero UI dependencies (no chart library in package.json)
- The 6 charts are simple (bars, lines, donut) — no complex interactions needed
- SVG integrates naturally with the CSS variable theming system
- Keeps bundle size minimal (~8MB target)

### Chart Components

Create reusable chart primitives in `src/lib/components/charts/`:

- `BarChart.svelte` — vertical bars, optional stacking, configurable colors
- `DonutChart.svelte` — donut/pie with center label
- `StatCard.svelte` — single metric display (number + label)

Each component accepts data as props and renders SVG. No interactivity beyond hover tooltips (CSS-only, `<title>` elements).

### Theming

Charts use existing CSS variables:
- `--c-again`, `--c-hard`, `--c-good`, `--c-easy` for rating colors
- `--accent` for primary data
- `--text-primary`, `--text-muted` for labels
- `--border` for grid lines
- `--bg-elevated` for chart background

Works across all 3 themes (Warm Ink, Muted Sage, Near-Mono) and dark/light mode.

## Data Flow

### Fetching Stats Data

Two data sources:

1. **Card snapshot** (already in memory): `$cards` store, filtered by deck if applicable. Used for: Today overview (avg interval), Future Due, Intervals, Card Counts.

2. **Review log** (new Tauri query): A single command `db_get_review_stats` returns aggregated data for the selected time range and optional deck filter:

```rust
#[tauri::command]
pub fn db_get_review_stats(
    state: State<'_, DbState>,
    deck_id: Option<String>,
    since: Option<i64>,  // epoch ms cutoff
) -> Result<ReviewStats, String>
```

Returns:

```rust
pub struct ReviewStats {
    pub daily_counts: Vec<DayCount>,      // [{date, total, again, hard, good, easy}]
    pub today_count: i64,
    pub today_again: i64,
    pub today_correct: i64,
}

pub struct DayCount {
    pub date: String,  // "2026-04-10"
    pub total: i64,
    pub again: i64,
    pub hard: i64,
    pub good: i64,
    pub easy: i64,
}
```

The frontend derives Module 3 (Calendar) and Module 6 (Answer Buttons) from `daily_counts`. Module 1 (Today) uses `today_*` fields.

### Stats Store

New file: `src/lib/stores/stats.ts`

```typescript
export const statsRange = writable<'1m' | '3m' | '1y' | 'all'>('1m');
export const statsScope = writable<'deck' | 'all'>('deck');

// Derived: fetches review stats when range/scope/activeDeckId changes
export const reviewStats = derived(
  [statsRange, statsScope, activeDeckId],
  ([$range, $scope, $deckId], set) => {
    const since = rangeToCutoff($range);
    const deckId = $scope === 'deck' ? $deckId : undefined;
    invoke('db_get_review_stats', { deckId, since }).then(set);
  }
);
```

## Navigation

Add "Stats" entry to `Sidebar.svelte`:
- Icon: a simple bar chart icon (SVG inline, matching existing icon style)
- Position: after "Browse", before "Generate"
- Route: `'stats'`

Add `'stats'` to the router store's valid routes.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/db.rs` | review_log table, migration v3, db_log_review, db_get_review_stats commands |
| `src-tauri/src/lib.rs` | register new commands |
| `src/lib/stores/data.ts` | log review in applyFsrsChoice |
| `src/lib/stores/stats.ts` | **NEW** — stats store (range, scope, reviewStats) |
| `src/lib/stores/router.ts` | add 'stats' route |
| `src/lib/components/Sidebar.svelte` | add Stats nav item |
| `src/lib/components/charts/BarChart.svelte` | **NEW** — reusable bar chart |
| `src/lib/components/charts/DonutChart.svelte` | **NEW** — donut chart |
| `src/lib/components/charts/StatCard.svelte` | **NEW** — metric card |
| `src/lib/pages/StatsPage.svelte` | **NEW** — statistics page |

## Testing

### Rust Tests

- Migration v3 creates review_log table
- `db_log_review` inserts a row and can be queried back
- `db_get_review_stats` aggregates correctly (test with known data)
- Deck filter works (only counts matching deck_id)
- Time range filter works (since cutoff)
- Deleting a card cascades to review_log

### TypeScript Tests

- Stats store: `rangeToCutoff` returns correct epoch ms for each range
- Chart data derivation: card snapshot → interval buckets, card counts, future due grouping

### Manual E2E

- Stats page loads with empty state (no reviews yet)
- Review some cards → Stats page shows today's data
- Switch deck/all toggle → data updates
- Switch time range → chart data updates
- All 3 themes render charts correctly
- Dark/light mode colors are legible

## Edge Cases

- **No review history**: Show empty state message "Start reviewing to see statistics"
- **Single day of data**: Charts render with one bar, no axis compression issues
- **Deck with 0 cards**: Show "No cards in this deck"
- **Very long intervals (1000+ days)**: Interval histogram buckets handle gracefully with "1y+" bucket
