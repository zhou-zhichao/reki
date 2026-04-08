# Markdown + KaTeX + Image Rendering — Design Spec

**Date:** 2026-04-07
**Status:** Draft (pending user approval)
**Author:** brainstorming session

## Goal

Reki currently displays card front and back as plain text. This spec adds rich rendering: GitHub-flavored Markdown, KaTeX math, syntax-highlighted code blocks, and inline images. Cards in `data.ts` continue to store **raw markdown source**; rendering happens at display time.

## Scope

### In scope

- **Markdown:** Full GFM (CommonMark + tables, blockquotes, headings, strikethrough, task lists)
- **Code highlighting:** Shiki, on-demand language loading
- **Math:** KaTeX with `$...$` (inline) and `$$...$$` (block) delimiters
- **HTML safety:** DOMPurify with a decorative-tag allowlist (`ruby`, `rt`, `sub`, `sup`, `mark`, `kbd`, `dfn`); strip `script`, `iframe`, `on*` handlers, `javascript:` URLs
- **Editor UX:** Edit/Preview tab toggle in BrowsePage detail panel
- **Browse table column:** Strip markdown to plain text for the Front column
- **Images:**
  - Three input methods: drag-drop into textarea, paste from clipboard (Ctrl+V), file picker button
  - Content-addressed storage (`<sha256[..16]>.<ext>`) under app-data `media/` directory
  - Rendered via Tauri custom protocol (`asset://localhost/<filename>`)
  - Manual cleanup button in Settings ("Clean unused media")

### Out of scope

- Image editing / cropping / annotation
- Audio / video media
- Image upload to remote storage
- Automatic image cleanup (only manual)
- Custom themes for Shiki / KaTeX (use defaults that work with both light/dark theme)
- Card-level renderer overrides (every card uses the same renderer)

## Architecture

### Components

```
Svelte frontend
├── lib/components/Markdown.svelte         (display-only renderer)
├── lib/components/MarkdownEditor.svelte   (textarea + tab + image input)
├── lib/markdown.ts                         (renderMarkdown, stripMarkdown)
└── lib/media.ts                            (importBlob, toAssetUrl)
        │
        ▼ Tauri invoke
Rust backend
└── src/media.rs
    ├── media_dir(app)                      → PathBuf
    ├── media_save_blob(bytes, ext)         → String (filename)
    └── media_clean_unused(card_texts)      → CleanResult { deleted_count, freed_bytes }
```

All three input methods (drag, paste, file picker) yield a `Blob` / `File` object in the browser, so a single `media_save_blob` command handles all of them. We don't need a separate path-based command.

### Why this decomposition

- `Markdown.svelte` is the **single rendering entry point**. Three pages (Review, Browse preview tab, Generate) consume it. Future renderer changes touch one file.
- `MarkdownEditor.svelte` is only used in Browse. Generate displays AI output read-only and doesn't need editing.
- `lib/markdown.ts` exposes pure functions so logic can be unit-tested without DOM.
- `lib/media.ts` is the JS side of the media bridge — components don't call `invoke` directly.
- `src/media.rs` keeps all filesystem and hashing logic in Rust (consistent with the "core in Rust" architecture from `IDEAS.md`).

### Tauri custom protocol

Tauri exposes local files via its `asset:` protocol. We configure the protocol scope in `tauri.conf.json` to allow files under `$APPDATA/media/`. Markdown image renderer uses Tauri's `convertFileSrc(absolutePath, 'asset')` JS helper to build the URL — this hides the platform difference (Linux uses `http://asset.localhost/...`, Windows uses `https://asset.localhost/...`, macOS uses `asset://...`). The renderer takes the bare filename from `![alt](foo.png)`, joins with `media_dir`, and runs it through `convertFileSrc`.

## Data flow

### Display (Review / Generate / Browse preview)

```
Card.front (raw markdown in DB)
  → Markdown.svelte
    → marked.parse(src, { gfm: true, breaks: false }, customExtensions)
        ├─ math token rule  → katex.renderToString()
        ├─ code renderer    → await shiki.codeToHtml() (lazy lang load)
        └─ image renderer   → <img src={convertFileSrc(media_dir/filename, 'asset')}>
    → DOMPurify.sanitize(html, { ALLOWED_TAGS: [...]} )
    → injected via {@html}
```

Async behavior: Shiki loads language grammars on first use. `Markdown.svelte` uses a `$effect` that runs on `src` change, sets `renderedHtml` when done, and shows the raw text as a fallback during the brief async window.

### Edit (Browse Edit tab)

```
User typing       → bind:value updates raw text
User drops image  → files[] from drop event
User pastes       → DataTransferItems from clipboard
User clicks btn   → File from system picker
                       │
                       ▼
              media.ts importBlob(blob)
                       │
                       ▼
              invoke('media_save_blob', { bytes, ext })
                       │
                       ▼
              Rust:
                1. Hash bytes (sha256)
                2. filename = first 16 hex chars + ".ext"
                3. If file exists → return filename (dedup)
                4. Else write to media_dir/<filename>
                5. Return filename
                       │
                       ▼
              Insert "![image](filename)" at cursor position
```

### Strip markdown (Browse table column)

```
stripMarkdown(src)
  → marked.parse(src) → HTML
  → new DOMParser().parseFromString(html, 'text/html')
  → doc.body.textContent
  → trim whitespace, collapse newlines
```

### Cleanup unused images

```
User clicks "Clean unused media" in Settings
  → frontend: collect every card.front + card.back (raw markdown)
  → invoke('media_clean_unused', { texts: string[] })
    → Rust:
        1. For each text, regex /!\[[^\]]*\]\(([^)]+)\)/g extract referenced filenames
        2. List media_dir/* entries
        3. Set difference: files - referenced = orphans
        4. Sum sizes, delete files
        5. Return { deletedCount, freedBytes }
  → frontend: show inline result message under the button: "Removed N images (X MB freed)"
```

## Schema

No database schema changes. Card.front and Card.back already store strings; we now interpret them as markdown.

## Error handling

| Failure | Behavior |
|---|---|
| Markdown parse error | Show raw text + small "Render failed: <msg>" warning at top |
| KaTeX parse error | Show `\textcolor{red}{<error>}` inline (KaTeX's own error mode) |
| Shiki language not found | Fall back to plain `<pre><code>` block |
| DOMPurify rejects all content | Show empty + warning text inline |
| Image file save fails (disk full, etc.) | Inline error under the editor, don't insert anything in textarea |
| asset:// path resolves to nonexistent file | Browser shows broken image; we accept this |
| Cleanup runs while another save is in progress | Cleanup uses a snapshot of texts at start; race is acceptable |

## Security

- **DOMPurify config:**
  ```js
  {
    ALLOWED_TAGS: [
      // text formatting
      'p', 'div', 'span', 'strong', 'em', 'del', 'ins', 'mark', 'sub', 'sup', 'kbd', 'dfn', 'br', 'hr',
      // headings
      'h1','h2','h3','h4','h5','h6',
      // lists
      'ul', 'ol', 'li', 'input',
      // code
      'pre', 'code',
      // tables
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      // blockquote
      'blockquote',
      // links
      'a',
      // images
      'img',
      // CJK
      'ruby', 'rt', 'rp',
      // KaTeX produces these
      'math', 'mrow', 'mi', 'mo', 'mn', 'mfrac', 'msqrt', 'msup', 'msub',
      'svg', 'path', 'g', 'use', 'defs', 'symbol',
      'annotation', 'semantics',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src', 'class', 'style', 'aria-hidden',
      'colspan', 'rowspan', 'type', 'checked', 'disabled', 'tabindex',
      // SVG attrs for KaTeX
      'd', 'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'xlink:href',
      'transform', 'width', 'height', 'fill', 'stroke', 'x', 'y',
    ],
    ALLOWED_URI_REGEXP: /^(?:asset:|https?:|mailto:|#|tauri:)/i,
    ALLOW_DATA_ATTR: false,
  }
  ```
- All `on*` event attributes are stripped automatically by DOMPurify.
- `javascript:` URLs are blocked by `ALLOWED_URI_REGEXP`.
- Tauri capabilities: add `asset:` protocol scope limited to `$APPDATA/media/*`.

## Testing

### Rust unit tests (`src/media.rs`)

- `media_save_blob` writes file and returns expected hash filename
- Saving the same blob twice returns same filename, doesn't duplicate file
- `media_clean_unused` removes orphans and keeps referenced files
- `media_clean_unused` parses `![alt](filename.png)` correctly including:
  - Multiple images per text
  - Images with spaces in alt text
  - Empty alt text
  - Filenames with dots and dashes

### TypeScript tests (`lib/markdown.ts` — vitest if added, else manual checklist)

- Renders `**bold**` to `<strong>bold</strong>`
- Renders `$x^2$` to KaTeX HTML
- Renders code blocks with shiki classes
- Strips markdown for tables (`stripMarkdown('**bold**') === 'bold'`)
- DOMPurify removes `<script>` tags from input
- Image renderer converts `![](foo.png)` to `asset://` URL
- Custom HTML in input: `<ruby>` survives, `<iframe>` is removed

### Manual E2E checklist

1. Edit a card in Browse, write `# Hello\n\n**bold** and *italic* and \`code\`` → Preview tab shows formatted
2. Write `$E = mc^2$` and `$$\int_0^\infty e^{-x^2}dx$$` → KaTeX renders both
3. Write a fenced code block with `\`\`\`rust` → Shiki highlights it
4. Drag a PNG into textarea → image inserts as `![image](xxx.png)` and renders
5. Paste a screenshot from clipboard → same as above
6. Click image button → file picker → same as above
7. Save card, restart Reki → image still shows
8. Add a card with image, delete that card, click "Clean unused media" → image file removed
9. Verify the Browse table column shows plain text (no markdown syntax visible)
10. Try injecting `<script>alert(1)</script>` in a card → no alert fires

## Open questions / known risks

- **Shiki bundle size:** core ~80KB, plus per-language grammar files. We accept the increase. If it becomes a problem we can switch to `shiki-twoslash`'s smaller variant later.
- **Image hash collisions:** sha256 truncated to 16 hex chars (64 bits). For a personal-scale app this is enough; collision probability becomes meaningful around 2^32 distinct images (~4 billion).
- **Race condition during cleanup:** if a user adds an image to a card while cleanup is running, the new filename might not be in the snapshot and could be deleted. Documented; we choose to defer fix until it's a real issue.
- **Tauri asset protocol on Windows:** path separators differ. We normalize to forward slashes in `media_dir().join(filename)` since Rust handles both.
- **Very large pastes:** clipboard images can be megabytes. Add a size limit (10 MB) in `media_save_blob` to prevent accidental disk fills.

## Files touched

**New files:**
- `src/lib/components/Markdown.svelte`
- `src/lib/components/MarkdownEditor.svelte`
- `src/lib/markdown.ts`
- `src/lib/media.ts`
- `src-tauri/src/media.rs`

**Modified files:**
- `package.json` — add `marked`, `katex`, `shiki`, `dompurify` (+ types)
- `src-tauri/Cargo.toml` — add `sha2 = "0.10"`
- `src-tauri/src/lib.rs` — register `media` module + commands
- `src-tauri/tauri.conf.json` — configure asset protocol scope
- `src-tauri/capabilities/default.json` — allow asset protocol for media dir
- `src/lib/pages/ReviewPage.svelte` — replace `{currentCard.front}` and `{currentCard.back}` with `<Markdown src={...} />`
- `src/lib/pages/GeneratePage.svelte` — replace inner card preview with `<Markdown />`
- `src/lib/pages/BrowsePage.svelte` —
  - Detail panel: replace front/back textareas with `<MarkdownEditor>`
  - Table front column: use `stripMarkdown(card.front)` instead of raw `{card.front}`
- `src/lib/pages/SettingsPage.svelte` — add "Clean unused media" button + result toast
