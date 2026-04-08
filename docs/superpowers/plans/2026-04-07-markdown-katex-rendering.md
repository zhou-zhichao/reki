# Markdown + KaTeX + Image Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub-flavored Markdown rendering, KaTeX math, syntax-highlighted code blocks (Shiki), and inline image support (drag/paste/picker) to Reki's card display and editor surfaces.

**Architecture:** Frontend renders markdown via marked + katex + shiki + DOMPurify in a single `Markdown.svelte` component shared by Review/Browse/Generate. A separate `MarkdownEditor.svelte` provides Edit/Preview tabs and image input. Image bytes are persisted by a new Rust `media` module to `$APPDATA/media/<sha256[..16]>.<ext>` and served via Tauri's asset protocol. Cards continue storing raw markdown source in SQLite — no schema change.

**Tech Stack:**
- Rust: `sha2 = "0.10"` for content hashing
- TS: `marked`, `katex`, `shiki`, `dompurify` (+ `@types/*` where needed)
- Svelte 5 + Tauri 2 (existing)
- vitest for JS unit tests (added as part of Task 2)

**Spec:** `docs/superpowers/specs/2026-04-07-markdown-katex-rendering-design.md`

---

## File structure

**New files:**
- `src-tauri/src/media.rs` — content-addressed image storage, sha256 hashing, orphan cleanup, Tauri commands
- `src/lib/markdown.ts` — `renderMarkdown(src)` and `stripMarkdown(src)` pure functions (lazy-loads shiki internals)
- `src/lib/media.ts` — `importBlob(blob)` and `toAssetUrl(filename)` JS bridge
- `src/lib/components/Markdown.svelte` — async-aware display component
- `src/lib/components/MarkdownEditor.svelte` — Edit/Preview tab editor with image input
- `src/lib/markdown.test.ts` — vitest unit tests for the pure markdown functions
- `vitest.config.ts` — minimal vitest configuration

**Modified files:**
- `src-tauri/Cargo.toml` — add `sha2` dep
- `src-tauri/src/lib.rs` — register `media` module + 2 commands
- `src-tauri/tauri.conf.json` — declare asset protocol scope
- `src-tauri/capabilities/default.json` — allow asset protocol
- `package.json` — add JS deps + vitest
- `src/app.css` — import KaTeX stylesheet
- `src/lib/pages/ReviewPage.svelte` — use `<Markdown>` for front/back
- `src/lib/pages/GeneratePage.svelte` — use `<Markdown>` in card preview
- `src/lib/pages/BrowsePage.svelte` — use `<MarkdownEditor>` in detail panel; use `stripMarkdown` in table column
- `src/lib/pages/SettingsPage.svelte` — add "Clean unused media" button

**No DB schema changes.**

---

## Task 1: Rust media storage

**Files:**
- Modify: `src-tauri/Cargo.toml` (add sha2 dep)
- Create: `src-tauri/src/media.rs`
- Modify: `src-tauri/src/lib.rs` (register module, register commands)
- Modify: `src-tauri/tauri.conf.json` (asset protocol scope)
- Modify: `src-tauri/capabilities/default.json` (allow asset protocol)

- [ ] **Step 1: Add sha2 dependency**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo add sha2
```

Expected: `Adding sha2 v0.10.x`

- [ ] **Step 2: Create media.rs skeleton with types and tests scaffold**

Create `src-tauri/src/media.rs`:

```rust
//! Content-addressed image storage for card media.
//!
//! Files live under the OS app-data directory:
//!   Linux:   ~/.local/share/at.outlook.zhichao.reki/media/
//!   macOS:   ~/Library/Application Support/at.outlook.zhichao.reki/media/
//!   Windows: %APPDATA%\at.outlook.zhichao.reki\media\
//!
//! Filenames are `<sha256[..16]>.<ext>` so identical bytes deduplicate.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const MAX_BLOB_BYTES: usize = 10 * 1024 * 1024; // 10 MB hard ceiling

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub deleted_count: u64,
    pub freed_bytes: u64,
}

pub fn media_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should be resolvable")
        .join("media");
    fs::create_dir_all(&dir).expect("create media dir");
    dir
}

#[cfg(test)]
mod tests {
    use super::*;
}
```

- [ ] **Step 3: Write failing test for save_blob_to_dir**

Add to the `tests` module in `src-tauri/src/media.rs`:

```rust
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn save_blob_writes_file_with_hash_filename() {
        let dir = TempDir::new().unwrap();
        let bytes = b"hello world".to_vec();

        let filename = save_blob_to_dir(dir.path(), &bytes, "txt").unwrap();

        // First 16 hex chars of sha256("hello world") + ".txt"
        assert_eq!(filename, "b94d27b9934d3e08.txt");
        let saved = fs::read(dir.path().join(&filename)).unwrap();
        assert_eq!(saved, bytes);
    }
```

Add the dev-dependency for tempfile:

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo add --dev tempfile
```

- [ ] **Step 4: Run test, expect compilation failure (no save_blob_to_dir)**

```bash
cd /home/sam/anki-rewrite/src-tauri
source "$HOME/.cargo/env"
cargo test --lib media::tests::save_blob_writes_file_with_hash_filename 2>&1 | tail -20
```

Expected: `error[E0425]: cannot find function 'save_blob_to_dir'`

- [ ] **Step 5: Implement save_blob_to_dir**

Add above the `tests` module in `src-tauri/src/media.rs`:

```rust
/// Save raw bytes to `dir/<sha256[..16]>.<ext>`. Returns the filename.
/// If a file with the same hash already exists, returns the existing
/// filename without rewriting (content-addressed dedup).
///
/// `ext` should be a sanitized extension like "png" / "jpg" (no dot, no slash).
pub fn save_blob_to_dir(dir: &Path, bytes: &[u8], ext: &str) -> Result<String, String> {
    if bytes.len() > MAX_BLOB_BYTES {
        return Err(format!(
            "Image too large ({} bytes, max {})",
            bytes.len(),
            MAX_BLOB_BYTES
        ));
    }

    let safe_ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if safe_ext.is_empty() {
        return Err("Empty or invalid file extension".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hex: String = digest.iter().take(8).map(|b| format!("{:02x}", b)).collect();
    let filename = format!("{}.{}", hex, safe_ext);

    let target = dir.join(&filename);
    if !target.exists() {
        fs::write(&target, bytes).map_err(|e| format!("Write failed: {e}"))?;
    }
    Ok(filename)
}
```

- [ ] **Step 6: Run test, expect pass**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo test --lib media::tests::save_blob_writes_file_with_hash_filename 2>&1 | tail -10
```

Expected: `test result: ok. 1 passed`

- [ ] **Step 7: Add deduplication test**

Add to the `tests` module:

```rust
    #[test]
    fn save_blob_deduplicates_identical_bytes() {
        let dir = TempDir::new().unwrap();
        let bytes = b"same content".to_vec();

        let f1 = save_blob_to_dir(dir.path(), &bytes, "png").unwrap();
        let f2 = save_blob_to_dir(dir.path(), &bytes, "png").unwrap();

        assert_eq!(f1, f2);

        // Only one file should exist
        let count = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(count, 1);
    }
```

- [ ] **Step 8: Run dedup test, expect pass**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo test --lib media::tests::save_blob_deduplicates 2>&1 | tail -10
```

Expected: `test result: ok. 1 passed`

- [ ] **Step 9: Add size-limit and bad-extension tests**

```rust
    #[test]
    fn save_blob_rejects_oversized_input() {
        let dir = TempDir::new().unwrap();
        let bytes = vec![0u8; MAX_BLOB_BYTES + 1];
        let err = save_blob_to_dir(dir.path(), &bytes, "png").unwrap_err();
        assert!(err.contains("too large"));
    }

    #[test]
    fn save_blob_rejects_empty_extension() {
        let dir = TempDir::new().unwrap();
        let err = save_blob_to_dir(dir.path(), b"x", "").unwrap_err();
        assert!(err.contains("Empty"));
    }

    #[test]
    fn save_blob_sanitizes_extension() {
        let dir = TempDir::new().unwrap();
        // "../../etc" should be filtered to "etc"
        let filename = save_blob_to_dir(dir.path(), b"x", "../etc").unwrap();
        assert!(filename.ends_with(".etc"));
    }
```

- [ ] **Step 10: Run all media tests, expect pass**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo test --lib media:: 2>&1 | tail -15
```

Expected: `test result: ok. 5 passed` (assuming tests added so far)

- [ ] **Step 11: Add failing test for cleanup_unused_in_dir**

```rust
    #[test]
    fn cleanup_removes_orphans_keeps_referenced() {
        let dir = TempDir::new().unwrap();
        let kept = save_blob_to_dir(dir.path(), b"keep me", "png").unwrap();
        let _orphan = save_blob_to_dir(dir.path(), b"orphan", "png").unwrap();

        // Card text references only `kept`
        let texts = vec![format!("Some card with ![alt]({})", kept)];

        let result = cleanup_unused_in_dir(dir.path(), &texts).unwrap();

        assert_eq!(result.deleted_count, 1);
        assert!(result.freed_bytes > 0);

        // The kept file is still there
        assert!(dir.path().join(&kept).exists());
        // Only one file remains
        let count = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(count, 1);
    }

    #[test]
    fn cleanup_handles_multiple_images_per_text_and_quirks() {
        let dir = TempDir::new().unwrap();
        let a = save_blob_to_dir(dir.path(), b"a", "png").unwrap();
        let b = save_blob_to_dir(dir.path(), b"b", "jpg").unwrap();
        let c = save_blob_to_dir(dir.path(), b"c", "gif").unwrap();
        let _orphan = save_blob_to_dir(dir.path(), b"orphan", "png").unwrap();

        let texts = vec![
            format!("![](( {} ))", a),                // weird parens
            format!("![alt with spaces]({})", b),     // spaces in alt
            format!("![]({}) and ![]({})", c, a),     // multiple, repeats
        ];

        let result = cleanup_unused_in_dir(dir.path(), &texts).unwrap();
        assert_eq!(result.deleted_count, 1);
        assert!(dir.path().join(&a).exists());
        assert!(dir.path().join(&b).exists());
        assert!(dir.path().join(&c).exists());
    }
```

- [ ] **Step 12: Implement cleanup_unused_in_dir**

Add above the `tests` module in `src-tauri/src/media.rs`:

```rust
/// Remove files in `dir` that aren't referenced by any markdown image
/// (`![alt](filename)`) in the supplied texts. Returns count and bytes freed.
pub fn cleanup_unused_in_dir(dir: &Path, texts: &[String]) -> Result<CleanResult, String> {
    // Collect referenced filenames from all card markdown.
    let referenced = collect_referenced_filenames(texts);

    let mut deleted_count: u64 = 0;
    let mut freed_bytes: u64 = 0;

    for entry in fs::read_dir(dir).map_err(|e| format!("read_dir: {e}"))? {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        if !entry.file_type().map_err(|e| format!("file_type: {e}"))?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if referenced.contains(&name) {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if fs::remove_file(entry.path()).is_ok() {
            deleted_count += 1;
            freed_bytes += size;
        }
    }

    Ok(CleanResult { deleted_count, freed_bytes })
}

fn collect_referenced_filenames(texts: &[String]) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    for text in texts {
        let mut rest = text.as_str();
        while let Some(idx) = rest.find("![") {
            rest = &rest[idx + 2..];
            // Skip alt text up to the next `]`
            let close_alt = match rest.find(']') {
                Some(i) => i,
                None => break,
            };
            rest = &rest[close_alt + 1..];
            // Expect `(` next, possibly with leading whitespace
            let trimmed = rest.trim_start();
            if !trimmed.starts_with('(') {
                continue;
            }
            rest = &trimmed[1..];
            // Read until `)`. Trim whitespace and any leading `(` (we're tolerant).
            let close = match rest.find(')') {
                Some(i) => i,
                None => break,
            };
            let raw = &rest[..close];
            let filename = raw.trim().trim_start_matches('(').trim();
            // Strip optional title:  `(filename "title")`
            let bare = filename.split_whitespace().next().unwrap_or("");
            if !bare.is_empty() {
                out.insert(bare.to_string());
            }
            rest = &rest[close + 1..];
        }
    }
    out
}
```

- [ ] **Step 13: Run cleanup tests, expect pass**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo test --lib media:: 2>&1 | tail -15
```

Expected: `test result: ok. 7 passed`

- [ ] **Step 14: Add Tauri commands at the bottom of media.rs**

```rust
pub type MediaState = ();

#[tauri::command]
pub async fn media_save_blob(
    app: AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let dir = media_dir(&app);
    save_blob_to_dir(&dir, &bytes, &ext)
}

#[tauri::command]
pub async fn media_clean_unused(
    app: AppHandle,
    texts: Vec<String>,
) -> Result<CleanResult, String> {
    let dir = media_dir(&app);
    cleanup_unused_in_dir(&dir, &texts)
}
```

- [ ] **Step 15: Register module + commands in lib.rs**

Modify `src-tauri/src/lib.rs`:

Find the line `mod srs;` and add below it:

```rust
mod media;
```

Find the existing `invoke_handler` block:

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
        ])
```

Add the two media commands at the end:

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
            media::media_save_blob,
            media::media_clean_unused,
        ])
```

- [ ] **Step 16: Configure Tauri asset protocol scope**

Modify `src-tauri/tauri.conf.json`. Find the `"app"` block and add an `assetProtocol` security entry. The full block should look like:

```json
"app": {
    "windows": [
      {
        "title": "Reki 歴",
        "width": 1100,
        "height": 720,
        "minWidth": 680,
        "minHeight": 480,
        "resizable": true,
        "fullscreen": false,
        "decorations": true
      }
    ],
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPDATA/media/*", "$APPDATA/media/**"]
      }
    }
  },
```

- [ ] **Step 17: Allow asset protocol in capabilities**

Modify `src-tauri/capabilities/default.json`. Add `"core:webview:default"` and the asset scope to permissions:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "claude",
          "cmd": "claude",
          "args": true
        }
      ]
    }
  ]
}
```

(No additional permission identifier needed in Tauri 2 — the assetProtocol scope in tauri.conf.json is what gates access. Capabilities file is unchanged.)

- [ ] **Step 18: Run full Rust test suite**

```bash
cd /home/sam/anki-rewrite/src-tauri
cargo test --quiet 2>&1 | tail -15
```

Expected: All tests pass (db, srs, lib::tests, media tests).

- [ ] **Step 19: Build the desktop app to confirm Tauri config validates**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
pkill -f "/usr/bin/reki" 2>/dev/null; pkill reki 2>/dev/null; sleep 0.5
npx tauri build 2>&1 | tail -10
```

Expected: build succeeds, deb/rpm/AppImage produced.

---

## Task 2: JS markdown rendering core

**Files:**
- Modify: `package.json` (deps)
- Create: `vitest.config.ts`
- Create: `src/lib/markdown.ts`
- Create: `src/lib/markdown.test.ts`

- [ ] **Step 1: Install JS deps**

```bash
cd /home/sam/anki-rewrite
npm install marked katex shiki dompurify
npm install -D vitest jsdom @types/dompurify
```

Expected: deps added to package.json.

- [ ] **Step 2: Add vitest script and config**

Add to the `scripts` section of `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 3: Create markdown.ts skeleton**

Create `src/lib/markdown.ts`:

```ts
/**
 * Markdown rendering utilities for Reki.
 *
 * Pipeline: marked (GFM) → custom math + image renderers →
 *           Shiki for code blocks → DOMPurify allowlist sanitization.
 *
 * Public surface:
 *   renderMarkdown(src) → Promise<string>   sanitized HTML
 *   stripMarkdown(src)  → string            plain text for tables
 */

import { marked, type Tokens } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';

// ────────────────────────────────────────────────────────────
// DOMPurify configuration
// ────────────────────────────────────────────────────────────

const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'div', 'span', 'strong', 'em', 'del', 'ins', 'mark',
    'sub', 'sup', 'kbd', 'dfn', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'input',
    'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'blockquote',
    'a', 'img',
    'ruby', 'rt', 'rp',
    // KaTeX output
    'math', 'mrow', 'mi', 'mo', 'mn', 'mfrac', 'msqrt', 'msup', 'msub',
    'svg', 'path', 'g', 'use', 'defs', 'symbol', 'annotation', 'semantics',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'alt', 'src', 'class', 'style', 'aria-hidden',
    'colspan', 'rowspan', 'type', 'checked', 'disabled', 'tabindex',
    'd', 'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink',
    'xlink:href', 'transform', 'width', 'height', 'fill', 'stroke', 'x', 'y',
  ],
  ALLOWED_URI_REGEXP: /^(?:asset:|https?:|mailto:|#|tauri:)/i,
  ALLOW_DATA_ATTR: false,
};

// ────────────────────────────────────────────────────────────
// marked extensions
// ────────────────────────────────────────────────────────────

/** Inline `$...$` and block `$$...$$` math via KaTeX. */
const mathExtension: any = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block' as const,
      start(src: string) { return src.indexOf('$$'); },
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
      },
      renderer(token: any) {
        try {
          return `<div class="math math-display">${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`;
        } catch (e) {
          return `<div class="math math-error">Math error: ${(e as Error).message}</div>`;
        }
      },
    },
    {
      name: 'mathInline',
      level: 'inline' as const,
      start(src: string) { return src.indexOf('$'); },
      tokenizer(src: string) {
        const m = /^\$([^$\n]+?)\$/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1] };
      },
      renderer(token: any) {
        try {
          return `<span class="math math-inline">${katex.renderToString(token.text, { displayMode: false, throwOnError: false })}</span>`;
        } catch (e) {
          return `<span class="math math-error">${(e as Error).message}</span>`;
        }
      },
    },
  ],
};

// ────────────────────────────────────────────────────────────
// Image renderer — rewrites filename to asset:// URL
// ────────────────────────────────────────────────────────────

/** Hook for resolving image filenames to asset URLs. Set externally before rendering. */
export type ImageResolver = (filename: string) => string;

let imageResolver: ImageResolver = (filename) => filename;

export function setImageResolver(fn: ImageResolver): void {
  imageResolver = fn;
}

// ────────────────────────────────────────────────────────────
// Shiki — lazy load + render code blocks
// ────────────────────────────────────────────────────────────

let shikiHighlighter: any = null;
const loadedLangs = new Set<string>();

async function getShiki() {
  if (!shikiHighlighter) {
    const { createHighlighter } = await import('shiki');
    shikiHighlighter = await createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [],
    });
  }
  return shikiHighlighter;
}

async function renderCodeBlock(code: string, lang: string): Promise<string> {
  const cleanLang = (lang || '').toLowerCase().trim();
  if (!cleanLang) {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
  try {
    const shiki = await getShiki();
    if (!loadedLangs.has(cleanLang)) {
      await shiki.loadLanguage(cleanLang);
      loadedLangs.add(cleanLang);
    }
    return shiki.codeToHtml(code, { lang: cleanLang, theme: 'github-dark' });
  } catch {
    return `<pre><code class="language-${escapeHtml(cleanLang)}">${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

let configured = false;

function configure() {
  if (configured) return;
  marked.use(mathExtension);
  marked.use({
    async: true,
    walkTokens: async (token: Tokens.Generic) => {
      if (token.type === 'code') {
        const code = (token as Tokens.Code).text;
        const lang = (token as Tokens.Code).lang || '';
        (token as any).rendered = await renderCodeBlock(code, lang);
      }
    },
    renderer: {
      code(token: any) {
        if (token.rendered) return token.rendered;
        return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
      },
      image(token: any) {
        const resolved = imageResolver(token.href || '');
        const alt = escapeHtml(token.text || '');
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<img src="${resolved}" alt="${alt}"${title}>`;
      },
    },
  });
  configured = true;
}

/** Render markdown source to sanitized HTML. */
export async function renderMarkdown(src: string): Promise<string> {
  configure();
  if (!src) return '';
  try {
    const html = await marked.parse(src, { gfm: true, breaks: false, async: true });
    return DOMPurify.sanitize(html as string, PURIFY_CONFIG);
  } catch (e) {
    return `<div class="md-error">Render failed: ${escapeHtml((e as Error).message)}</div>`;
  }
}

/** Strip markdown formatting and return plain text (for table previews). */
export function stripMarkdown(src: string, maxLen = 120): string {
  if (!src) return '';
  // Naive but fast: strip the most common markdown syntax with regexes.
  // We avoid running marked here because table rendering should stay synchronous.
  const stripped = src
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links → text
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold/italic
    .replace(/^#+\s*/gm, '')                  // headings
    .replace(/^\s*[-*+]\s+/gm, '')            // list bullets
    .replace(/^\s*\d+\.\s+/gm, '')            // ordered list
    .replace(/^\s*>\s?/gm, '')                // blockquote
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')        // block math
    .replace(/\$([^$]*)\$/g, '$1')            // inline math
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen - 1) + '…';
}
```

- [ ] **Step 4: Write failing tests**

Create `src/lib/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderMarkdown, stripMarkdown, setImageResolver } from './markdown';

describe('renderMarkdown', () => {
  it('renders bold and italic', async () => {
    const html = await renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders inline KaTeX math', async () => {
    const html = await renderMarkdown('Energy: $E = mc^2$');
    expect(html).toContain('katex');
    expect(html).toContain('class="math math-inline"');
  });

  it('renders block KaTeX math', async () => {
    const html = await renderMarkdown('$$\\int_0^1 x^2 dx$$');
    expect(html).toContain('class="math math-display"');
  });

  it('strips script tags via DOMPurify', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>Hello');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Hello');
  });

  it('preserves ruby tags from the allowlist', async () => {
    const html = await renderMarkdown('<ruby>漢<rt>kan</rt></ruby>');
    expect(html).toContain('<ruby>');
    expect(html).toContain('<rt>');
  });

  it('strips iframe tags', async () => {
    const html = await renderMarkdown('<iframe src="http://evil"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips javascript: URLs', async () => {
    const html = await renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('routes image filenames through the resolver', async () => {
    setImageResolver((f) => `asset://test/${f}`);
    const html = await renderMarkdown('![alt](abc.png)');
    expect(html).toContain('asset://test/abc.png');
    expect(html).toContain('alt="alt"');
  });

  it('renders fenced code blocks', async () => {
    const html = await renderMarkdown('```\nplain\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('plain');
  });
});

describe('stripMarkdown', () => {
  it('strips bold', () => {
    expect(stripMarkdown('**bold** text')).toBe('bold text');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('`code` here')).toBe('code here');
  });

  it('replaces images with alt text', () => {
    expect(stripMarkdown('![my img](foo.png) caption')).toBe('my img caption');
  });

  it('replaces links with text', () => {
    expect(stripMarkdown('a [link](url) here')).toBe('a link here');
  });

  it('strips headings', () => {
    expect(stripMarkdown('# Heading\n\nbody')).toBe('Heading body');
  });

  it('strips bullets', () => {
    expect(stripMarkdown('- one\n- two')).toBe('one two');
  });

  it('truncates with ellipsis', () => {
    const long = 'x'.repeat(200);
    const result = stripMarkdown(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles empty input', () => {
    expect(stripMarkdown('')).toBe('');
  });
});
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd /home/sam/anki-rewrite
npx vitest run src/lib/markdown.test.ts 2>&1 | tail -25
```

Expected: All tests pass (17+ tests). If any fail because of jsdom DOMParser oddities or shiki ESM issues, fix and re-run.

---

## Task 3: JS media bridge

**Files:**
- Create: `src/lib/media.ts`

- [ ] **Step 1: Implement media.ts**

Create `src/lib/media.ts`:

```ts
/**
 * JS bridge for the Rust media module.
 *
 * Functions:
 *   importBlob(blob)        save a Blob/File and return its filename
 *   toAssetUrl(filename)    convert a filename to a Tauri asset URL
 *   cleanUnused(texts)      ask Rust to garbage-collect orphaned media
 */

import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';

export interface CleanResult {
  deletedCount: number;
  freedBytes: number;
}

/** Save a Blob/File to the media dir. Returns the bare filename. */
export async function importBlob(blob: Blob): Promise<string> {
  const ext = extensionFromBlob(blob);
  const buffer = await blob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  return invoke<string>('media_save_blob', { bytes, ext });
}

/** Build the asset URL for an image filename, suitable for <img src>. */
let cachedMediaDir: string | null = null;
export async function toAssetUrl(filename: string): Promise<string> {
  if (!cachedMediaDir) {
    const base = await appDataDir();
    cachedMediaDir = await join(base, 'media');
  }
  const fullPath = await join(cachedMediaDir, filename);
  return convertFileSrc(fullPath, 'asset');
}

/** Synchronous version: returns the Tauri-mapped URL using a cached media dir.
 *  Falls back to the bare filename if the media dir hasn't been resolved yet. */
let syncMediaDir: string | null = null;
export function toAssetUrlSync(filename: string): string {
  if (!syncMediaDir) return filename;
  return convertFileSrc(`${syncMediaDir}/${filename}`, 'asset');
}

/** Resolve the media dir once at app start so toAssetUrlSync works. */
export async function initMediaPaths(): Promise<void> {
  const base = await appDataDir();
  syncMediaDir = await join(base, 'media');
  cachedMediaDir = syncMediaDir;
}

export async function cleanUnused(texts: string[]): Promise<CleanResult> {
  return invoke<CleanResult>('media_clean_unused', { texts });
}

function extensionFromBlob(blob: Blob): string {
  const type = blob.type || '';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/svg+xml') return 'svg';
  if (type === 'image/bmp') return 'bmp';
  // Try to extract from File.name if available
  if ('name' in blob && typeof (blob as File).name === 'string') {
    const m = (blob as File).name.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  }
  return 'bin';
}
```

- [ ] **Step 2: Wire image resolver into markdown.ts via App.svelte mount**

Modify `src/App.svelte`. Add to the script section:

Find:
```ts
  import { loadFromDb, dataLoaded } from './lib/stores/data';

  onMount(() => {
    loadFromDb();
  });
```

Replace with:
```ts
  import { loadFromDb, dataLoaded } from './lib/stores/data';
  import { initMediaPaths, toAssetUrlSync } from './lib/media';
  import { setImageResolver } from './lib/markdown';

  onMount(async () => {
    await initMediaPaths();
    setImageResolver((filename) => toAssetUrlSync(filename));
    loadFromDb();
  });
```

- [ ] **Step 3: Manual smoke test**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
pkill -f "/usr/bin/reki" 2>/dev/null; pkill reki 2>/dev/null; sleep 0.5
npx tauri build 2>&1 | tail -10
```

Expected: build succeeds, no TS errors.

---

## Task 4: Markdown.svelte display component

**Files:**
- Create: `src/lib/components/Markdown.svelte`
- Modify: `src/app.css` (add KaTeX CSS import)

- [ ] **Step 1: Add KaTeX stylesheet**

Add to the very top of `src/app.css`:

```css
@import 'katex/dist/katex.min.css';
```

- [ ] **Step 2: Create Markdown.svelte**

Create `src/lib/components/Markdown.svelte`:

```svelte
<script lang="ts">
  import { renderMarkdown } from '../markdown';

  interface Props { src: string; }
  let { src }: Props = $props();

  let html = $state('');
  let pending = $state(false);

  $effect(() => {
    const current = src;
    pending = true;
    renderMarkdown(current).then(result => {
      // Discard stale results if src changed during render
      if (current === src) {
        html = result;
        pending = false;
      }
    });
  });
</script>

<div class="md" class:pending>
  {#if html}
    {@html html}
  {:else if pending}
    <pre class="md-fallback">{src}</pre>
  {/if}
</div>

<style>
  .md {
    line-height: 1.55;
    color: var(--text-primary);
  }

  .md.pending {
    opacity: 0.6;
  }

  .md-fallback {
    font-family: 'Geist', sans-serif;
    white-space: pre-wrap;
    background: none;
    padding: 0;
    margin: 0;
  }

  .md :global(p) { margin: 0 0 var(--sp-md) 0; }
  .md :global(p:last-child) { margin-bottom: 0; }

  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    font-family: 'Satoshi', sans-serif;
    margin: var(--sp-lg) 0 var(--sp-sm);
    color: var(--text-primary);
  }

  .md :global(h1) { font-size: var(--text-2xl); }
  .md :global(h2) { font-size: var(--text-xl); }
  .md :global(h3) { font-size: var(--text-lg); }
  .md :global(h4) { font-size: var(--text-base); font-weight: 600; }

  .md :global(strong) { font-weight: 600; color: var(--text-primary); }
  .md :global(em) { font-style: italic; }
  .md :global(del) { text-decoration: line-through; color: var(--text-muted); }

  .md :global(ul),
  .md :global(ol) {
    padding-left: var(--sp-lg);
    margin: 0 0 var(--sp-md) 0;
  }
  .md :global(li) { margin: var(--sp-2xs) 0; }
  .md :global(li > input[type="checkbox"]) { margin-right: var(--sp-xs); }

  .md :global(blockquote) {
    border-left: 3px solid var(--border-strong);
    padding-left: var(--sp-md);
    color: var(--text-secondary);
    margin: var(--sp-md) 0;
  }

  .md :global(code) {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 0.92em;
    background: var(--bg-elevated);
    padding: 1px 5px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
  }

  .md :global(pre) {
    margin: var(--sp-md) 0;
    padding: var(--sp-md);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow-x: auto;
    font-size: var(--text-sm);
  }

  .md :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
  }

  .md :global(table) {
    border-collapse: collapse;
    margin: var(--sp-md) 0;
    font-size: var(--text-sm);
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: var(--sp-xs) var(--sp-sm);
  }
  .md :global(th) {
    background: var(--bg-elevated);
    font-weight: 600;
    text-align: left;
  }

  .md :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .md :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--r-md);
    margin: var(--sp-sm) 0;
  }

  .md :global(.math-display) {
    margin: var(--sp-md) 0;
    overflow-x: auto;
  }

  .md :global(.md-error),
  .md :global(.math-error) {
    color: var(--c-again);
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
  }
</style>
```

- [ ] **Step 3: Build and verify nothing is broken**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
npx tauri build 2>&1 | tail -10
```

Expected: build succeeds.

---

## Task 5: Wire Markdown into Review and Generate pages

**Files:**
- Modify: `src/lib/pages/ReviewPage.svelte`
- Modify: `src/lib/pages/GeneratePage.svelte`

- [ ] **Step 1: Replace front/back text in ReviewPage**

Modify `src/lib/pages/ReviewPage.svelte`. Find the import block at the top of the script and add:

```ts
  import Markdown from '../components/Markdown.svelte';
```

Find this section in the template:
```svelte
        <div class="card-content">
          <div class="card-front">{currentCard.front}</div>

          {#if showAnswer}
            <div class="card-divider"></div>
            <div class="card-back">{currentCard.back}</div>
          {/if}
        </div>
```

Replace with:
```svelte
        <div class="card-content">
          <div class="card-front"><Markdown src={currentCard.front} /></div>

          {#if showAnswer}
            <div class="card-divider"></div>
            <div class="card-back"><Markdown src={currentCard.back} /></div>
          {/if}
        </div>
```

- [ ] **Step 2: Replace front/back text in GeneratePage card preview**

Modify `src/lib/pages/GeneratePage.svelte`. Add to the script:

```ts
  import Markdown from '../components/Markdown.svelte';
```

Find:
```svelte
            <div class="gen-card-content">
              <div class="gen-card-front">{card.front}</div>
              <div class="gen-card-sep"></div>
              <div class="gen-card-back">{card.back}</div>
            </div>
```

Replace with:
```svelte
            <div class="gen-card-content">
              <div class="gen-card-front"><Markdown src={card.front} /></div>
              <div class="gen-card-sep"></div>
              <div class="gen-card-back"><Markdown src={card.back} /></div>
            </div>
```

- [ ] **Step 3: Build and visually verify**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
pkill -f "/usr/bin/reki" 2>/dev/null; pkill reki 2>/dev/null; sleep 0.5
npx tauri build 2>&1 | tail -10
sudo dpkg -i src-tauri/target/release/bundle/deb/Reki_0.1.0_amd64.deb 2>&1 | tail -3
```

- [ ] **Step 4: Update one demo card with markdown so we can verify**

Edit the database directly to set markdown content on the Box<dyn Trait> card:

```bash
sqlite3 ~/.local/share/at.outlook.zhichao.reki/reki.db "UPDATE cards SET back = 'Heap-allocates a **trait object**, enabling _dynamic dispatch_.

\`\`\`rust
let x: Box<dyn Trait> = Box::new(MyType);
\`\`\`

Math: \$\$O(\\log n)\$\$' WHERE front LIKE '%Box<dyn%';"
```

- [ ] **Step 5: Launch and screenshot**

```bash
reki &
sleep 3
WID=$(xdotool search --name "Reki 歴" | head -1)
xdotool windowactivate --sync $WID
sleep 0.5
import -window $WID /tmp/md-review.png
```

Inspect `/tmp/md-review.png` — verify the Box<dyn Trait> card on Review page shows: bold "trait object", italic "dynamic dispatch", a syntax-highlighted Rust code block, and a KaTeX equation.

---

## Task 6: MarkdownEditor component

**Files:**
- Create: `src/lib/components/MarkdownEditor.svelte`

- [ ] **Step 1: Implement MarkdownEditor with Edit/Preview tabs and image input**

Create `src/lib/components/MarkdownEditor.svelte`:

```svelte
<script lang="ts">
  import Markdown from './Markdown.svelte';
  import { importBlob } from '../media';

  interface Props {
    value: string;
    label: string;
    rows?: number;
  }

  let { value = $bindable(''), label, rows = 5 }: Props = $props();

  type Tab = 'edit' | 'preview';
  let tab = $state<Tab>('edit');
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let error = $state<string | null>(null);
  let dragging = $state(false);

  function insertAtCursor(text: string) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    value = value.slice(0, start) + text + value.slice(end);
    // Restore cursor after the inserted text on next tick
    queueMicrotask(() => {
      if (!textarea) return;
      const pos = start + text.length;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      error = `Not an image: ${file.type || 'unknown type'}`;
      return;
    }
    error = null;
    try {
      const filename = await importBlob(file);
      insertAtCursor(`![image](${filename})`);
    } catch (e) {
      error = `Image upload failed: ${e}`;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const f of files) handleFile(f);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onDragLeave() {
    dragging = false;
  }

  function onPaste(e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
          return;
        }
      }
    }
  }

  function onPickFile() {
    fileInput?.click();
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const f of files) handleFile(f);
    input.value = '';
  }
</script>

<div class="md-editor">
  <div class="md-toolbar">
    <div class="md-tabs">
      <button
        class="tab"
        class:active={tab === 'edit'}
        onclick={() => tab = 'edit'}
      >Edit</button>
      <button
        class="tab"
        class:active={tab === 'preview'}
        onclick={() => tab = 'preview'}
      >Preview</button>
    </div>
    <button class="img-btn" onclick={onPickFile} title="Insert image">+ Image</button>
    <input
      type="file"
      accept="image/*"
      bind:this={fileInput}
      onchange={onFileChange}
      style="display: none"
    />
  </div>

  {#if tab === 'edit'}
    <textarea
      bind:this={textarea}
      bind:value
      class="md-textarea"
      class:dragging
      aria-label={label}
      {rows}
      ondrop={onDrop}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      onpaste={onPaste}
    ></textarea>
  {:else}
    <div class="md-preview">
      {#if value.trim()}
        <Markdown src={value} />
      {:else}
        <span class="md-preview-empty">(empty)</span>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="md-error">{error}</div>
  {/if}
</div>

<style>
  .md-editor {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .md-toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .md-tabs {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
    flex: 1;
  }

  .tab {
    flex: 1;
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    transition: all var(--dur-micro) var(--ease);
    border-right: 1px solid var(--border);
  }

  .tab:last-child { border-right: none; }

  .tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .img-btn {
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    transition: all var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .img-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .md-textarea {
    width: 100%;
    resize: vertical;
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-sm);
    line-height: 1.5;
    transition: border-color var(--dur-micro) var(--ease);
  }

  .md-textarea.dragging {
    border-color: var(--accent);
    background: var(--accent-bg);
  }

  .md-preview {
    min-height: 60px;
    padding: var(--sp-sm);
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: var(--text-sm);
  }

  .md-preview-empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .md-error {
    font-size: var(--text-xs);
    color: var(--c-again);
    padding: var(--sp-xs) var(--sp-sm);
    background: color-mix(in srgb, var(--c-again) 10%, transparent);
    border-radius: var(--r-sm);
  }
</style>
```

- [ ] **Step 2: Build and check for compile errors**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
npx tauri build 2>&1 | tail -10
```

Expected: build succeeds.

---

## Task 7: Wire MarkdownEditor into Browse page

**Files:**
- Modify: `src/lib/pages/BrowsePage.svelte`

- [ ] **Step 1: Add imports**

Modify `src/lib/pages/BrowsePage.svelte`. Find the script imports and add:

```ts
  import MarkdownEditor from '../components/MarkdownEditor.svelte';
  import { stripMarkdown } from '../markdown';
```

- [ ] **Step 2: Replace edit-front and edit-back textareas with MarkdownEditor**

Find:

```svelte
      <div class="detail-field">
        <label for="edit-front">Front</label>
        <textarea id="edit-front" bind:value={editFront} rows="3"></textarea>
      </div>

      <div class="detail-field">
        <label for="edit-back">Back</label>
        <textarea id="edit-back" bind:value={editBack} rows="5"></textarea>
      </div>
```

Replace with:

```svelte
      <div class="detail-field">
        <label>Front</label>
        <MarkdownEditor bind:value={editFront} label="Front" rows={3} />
      </div>

      <div class="detail-field">
        <label>Back</label>
        <MarkdownEditor bind:value={editBack} label="Back" rows={5} />
      </div>
```

- [ ] **Step 3: Use stripMarkdown in the table column**

Find:

```svelte
              <td class="col-front">{card.front}</td>
```

Replace with:

```svelte
              <td class="col-front">{stripMarkdown(card.front, 80)}</td>
```

- [ ] **Step 4: Build and run**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
pkill -f "/usr/bin/reki" 2>/dev/null; pkill reki 2>/dev/null; sleep 0.5
npx tauri build 2>&1 | tail -10
sudo dpkg -i src-tauri/target/release/bundle/deb/Reki_0.1.0_amd64.deb 2>&1 | tail -3
```

- [ ] **Step 5: Manual verification checklist**

Launch reki, navigate to Browse, click any card. Verify:

1. The editor shows Edit / Preview tabs
2. Clicking Preview renders the markdown
3. Typing `**bold**` shows bold in preview
4. Typing `$x^2$` shows KaTeX in preview
5. The Browse table column shows plain text (no markdown syntax visible)

If image testing is desired now, drag a small PNG into the Edit textarea — it should insert `![image](xxx.png)` and show in Preview. Then click Save and reopen the card to confirm persistence.

---

## Task 8: Clean unused media in Settings

**Files:**
- Modify: `src/lib/pages/SettingsPage.svelte`

- [ ] **Step 1: Add imports and state**

Modify `src/lib/pages/SettingsPage.svelte`. Add to script imports:

```ts
  import { cards } from '../stores/data';
  import { cleanUnused, type CleanResult } from '../media';
```

Add state variables alongside the others:

```ts
  let cleaning = $state(false);
  let cleanResult = $state<CleanResult | null>(null);
  let cleanError = $state<string | null>(null);

  async function runCleanup() {
    cleaning = true;
    cleanError = null;
    cleanResult = null;
    const texts: string[] = [];
    for (const c of $cards) {
      texts.push(c.front);
      texts.push(c.back);
    }
    try {
      cleanResult = await cleanUnused(texts);
    } catch (e) {
      cleanError = String(e);
    } finally {
      cleaning = false;
    }
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
```

- [ ] **Step 2: Add Media section to the template**

Find the existing `<section class="settings-section">` for "Import" and add a new section right before it:

```svelte
  <section class="settings-section">
    <h3 class="section-title">Media</h3>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">Clean unused media</span>
        <span class="setting-desc">Delete image files no card references anymore</span>
      </div>
      <button class="btn-secondary" onclick={runCleanup} disabled={cleaning}>
        {cleaning ? 'Cleaning…' : 'Clean now'}
      </button>
    </div>

    {#if cleanResult}
      <div class="clean-result">
        Removed {cleanResult.deletedCount} {cleanResult.deletedCount === 1 ? 'image' : 'images'}
        ({formatBytes(cleanResult.freedBytes)} freed)
      </div>
    {/if}
    {#if cleanError}
      <div class="clean-error">{cleanError}</div>
    {/if}
  </section>
```

- [ ] **Step 3: Add styles for the result/error messages**

Add to the `<style>` block of `SettingsPage.svelte`:

```css
  .clean-result {
    margin-top: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: color-mix(in srgb, var(--c-good) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-good) 30%, transparent);
    border-radius: var(--r-sm);
    color: var(--c-good);
    font-size: var(--text-xs);
  }

  .clean-error {
    margin-top: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: color-mix(in srgb, var(--c-again) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-again) 30%, transparent);
    border-radius: var(--r-sm);
    color: var(--c-again);
    font-size: var(--text-xs);
  }
```

- [ ] **Step 4: Build and verify**

```bash
cd /home/sam/anki-rewrite
source "$HOME/.cargo/env"
pkill -f "/usr/bin/reki" 2>/dev/null; pkill reki 2>/dev/null; sleep 0.5
npx tauri build 2>&1 | tail -10
sudo dpkg -i src-tauri/target/release/bundle/deb/Reki_0.1.0_amd64.deb 2>&1 | tail -3
```

- [ ] **Step 5: End-to-end media lifecycle test**

1. Launch Reki, go to Browse, open any card
2. Drag a small image into the Front textarea — it inserts as `![image](xxx.png)`
3. Click Preview tab — image displays
4. Click Save
5. Restart Reki — open the same card, image still displays
6. Delete the card
7. Go to Settings → Media → click "Clean now"
8. Result message should show "Removed 1 image (X KB freed)"
9. Click "Clean now" again — should show "Removed 0 images"
10. Verify on disk: `ls ~/.local/share/at.outlook.zhichao.reki/media/` — should not contain the deleted image's hash filename

---

## Self-Review

All spec requirements covered:

| Spec section | Plan task |
|---|---|
| Markdown GFM | Task 2 (marked GFM mode) |
| KaTeX `$..$` / `$$..$$` | Task 2 (math extensions) |
| Shiki code highlight | Task 2 (renderCodeBlock + lazy lang) |
| HTML allowlist | Task 2 (PURIFY_CONFIG) |
| Edit/Preview tab | Task 6 (MarkdownEditor tabs) |
| Strip markdown for table | Task 7 (stripMarkdown call) |
| Image drag input | Task 6 (onDrop) |
| Image paste input | Task 6 (onPaste) |
| Image picker input | Task 6 (onPickFile + fileInput) |
| Content-addressed storage | Task 1 (save_blob_to_dir) |
| Asset protocol rendering | Task 3 (toAssetUrl + initMediaPaths in App.svelte) |
| Manual cleanup button | Task 8 (Settings UI + runCleanup) |
| Rust unit tests | Task 1 (5 media tests) |
| TS unit tests | Task 2 (vitest) |

No unresolved placeholders, types consistent across tasks (CleanResult, ImageResolver, importBlob signature all match). Task 1 Step 17 leaves capabilities/default.json unchanged because Tauri 2's assetProtocol scope lives in tauri.conf.json, not in capabilities — verified against Tauri 2 docs.

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-04-07-markdown-katex-rendering.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Better for catching bugs and keeping main context clean.

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
