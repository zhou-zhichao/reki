# Reki 歴

A modern spaced repetition desktop app. Tauri 2 + Svelte 5 + Rust.

Built as an Anki replacement that cuts the Python middle layer, ships a ~8 MB
installer (vs Anki's ~150 MB), and uses the real FSRS-5 algorithm for
scheduling. Supports Markdown, KaTeX math, syntax-highlighted code blocks,
inline images, and AI-assisted card generation via Claude Code.

## Status

Early development. Core review loop, deck management, AI generation, and
SQLite persistence all work. No sync, no mobile, no plugins yet.

## Features

- **Real FSRS-5 scheduling** via the `fsrs` Rust crate (same algorithm Anki uses)
- **Full GFM Markdown** — tables, task lists, strikethrough, blockquotes
- **KaTeX math** with `$inline$` and `$$display$$` delimiters
- **Shiki code highlighting** (VS Code TextMate grammars)
- **Inline images** — drag, paste, or pick; content-addressed storage
- **Anki-compatible query language** — `deck:`, `tag:`, `is:due`, `prop:ivl>=10`,
  `re:`, `nc:`, `w:`, wildcards, boolean operators, grouping
- **Customizable keyboard shortcuts** for rating
- **Three themes** — system / light / dark
- **AI card generation** through your local `claude` CLI subscription
  (no API key required)
- **SQLite persistence** with content-addressed media storage

## Tech stack

- **Frontend:** Svelte 5 + TypeScript + Vite, pure CSS variables (no UI library)
- **Backend:** Rust via Tauri 2, `rusqlite` (bundled) for SQLite, `fsrs` for scheduling
- **Rendering:** `marked` + `katex` + `shiki` + `dompurify`
- **Testing:** `cargo test` for Rust, `vitest` for TypeScript

## Building

Requires Rust toolchain, Node 22+, and the Linux dev libraries for Tauri
(libwebkit2gtk-4.1-dev, libgtk-3-dev, etc.).

```bash
npm install
npm run tauri:dev     # dev with hot reload
npm run tauri:build   # production bundles (.deb, .rpm, .AppImage on Linux)
```

On macOS and Windows, run `npm run tauri:build` on the target OS to get
native installers.

## Testing

```bash
# Rust tests (db, srs, media)
cd src-tauri && cargo test

# TypeScript tests (markdown rendering)
npm run test
```

## Architecture

```
Svelte UI (src/)
  ├── lib/components/  reusable components (Markdown, MarkdownEditor, Sidebar)
  ├── lib/pages/       Review, Decks, Browse, Generate, Settings
  ├── lib/stores/      data, theme, router, shortcuts, srs
  ├── lib/markdown.ts  GFM + KaTeX + Shiki pipeline
  ├── lib/media.ts     image upload bridge
  └── lib/query.ts     Anki-compatible search parser

Rust backend (src-tauri/src/)
  ├── db.rs     SQLite schema, migrations, CRUD commands
  ├── srs.rs    FSRS-5 scheduler wrapper
  ├── media.rs  content-addressed image storage
  └── lib.rs    Tauri app setup + command registry

Design docs (docs/superpowers/specs/ and plans/)
```

The core idea: **no Python middle layer**. The frontend talks to Rust
directly through Tauri commands, cards and media persist to SQLite under
the OS app-data directory, and everything that can run in Rust does.

## License

MIT. See [LICENSE](LICENSE).

## Note on the original Anki

This is a ground-up rewrite that does NOT reuse any code from the original
Anki project (which is AGPL-3.0). It only borrows the FSRS algorithm (MIT
licensed) and the general concept of spaced repetition flashcards. All
other code is new.
