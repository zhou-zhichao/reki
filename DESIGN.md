# Design System — Reki 歴

## Product Context
- **What this is:** Modern Anki replacement. Spaced repetition flashcard app with AI card generation.
- **Who it's for:** Power learners who care about tools. Open-source community.
- **Space/industry:** Education / SRS tools. Peers: Anki (open, ugly), Mochi (closed, clean).
- **Project type:** Desktop app (Tauri 2 + Svelte 5)

## Aesthetic Direction
- **Direction:** Industrial-Refined
- **Decoration level:** Minimal — typography does all the work. No gradients, no decorative blobs, no colored icon circles.
- **Mood:** A precision instrument for learning. Sharp, quiet, purposeful. Like a well-made mechanical watch: no unnecessary elements, every detail intentional.
- **Reference:** Linear's tool feel, not Notion's canvas feel. Deep surfaces, tight borders, precise contrast.

## Typography
- **Display/Hero:** Satoshi 700/500 — Geometric precision, modern without being trendy. More personality than Inter, less quirky than anything experimental. Used for headings, navigation labels, card questions.
- **Body:** Geist 400/500/600 — Vercel's open-source typeface. Optimized for screen reading, built-in tabular-nums. Used for card content, descriptions, body text.
- **UI/Labels:** Geist 500 uppercase with letter-spacing for section labels, Geist 400 for inline labels.
- **Data/Tables:** Geist with font-variant-numeric: tabular-nums. Numbers align in columns.
- **Code:** Geist Mono 400 — Same family as body font, visual unity across code and prose.
- **Loading:** Satoshi via Fontshare CDN, Geist/Geist Mono via Google Fonts. Total ~60KB.
- **Scale:**
  - `--text-xs`: 11px
  - `--text-sm`: 13px
  - `--text-base`: 15px
  - `--text-lg`: 18px
  - `--text-xl`: 22px
  - `--text-2xl`: 28px
  - `--text-3xl`: 36px

## Color

### Approach: Ultra-restrained
Color is reserved for meaning. The UI is monochrome. The only real color appears in rating buttons and semantic alerts. Three theme variants, each with light and dark modes (6 themes total).

### Theme: Warm Ink (暖墨)
Warm copper accent on warm stone grays. Like studying in a book-lined room under warm light.

**Dark mode:**
- `--bg-app`: #1C1917
- `--bg-sidebar`: #211E1A
- `--bg-surface`: #211E1A
- `--bg-elevated`: #28241F
- `--bg-hover`: #302B25
- `--border`: #2C2520
- `--text-primary`: #FAFAF9
- `--text-secondary`: #A8A29E
- `--text-muted`: #78716C
- `--text-ghost`: #57534E
- `--accent`: #C4956A (warm copper — used sparingly for active nav items)

**Rating buttons:**
- Again: #B8626A (dusty rose)
- Hard: #C49A5A (amber)
- Good: #6B9E7A (sage)
- Easy: #7A9EB8 (steel blue)

### Theme: Muted Sage (静苍)
Sage green accent on cool green-gray. Like a quiet corner in a library.

**Dark mode:**
- `--bg-app`: #0F1210
- `--bg-sidebar`: #131816
- `--bg-surface`: #131816
- `--bg-elevated`: #1A201D
- `--bg-hover`: #222A26
- `--border`: #1A2420
- `--text-primary`: #E8ECE9
- `--text-secondary`: #8A9A90
- `--text-muted`: #5A6B60
- `--text-ghost`: #3A4A40
- `--accent`: #5A7A6B (sage green)

**Rating buttons:**
- Again: #9E6B6B (muted rose)
- Hard: #9E8E6B (khaki)
- Good: #5A7A6B (sage)
- Easy: #6B7A9E (slate)

### Theme: Near-Mono (近墨)
No color accent at all. Pure grayscale. Like a hardcover book where typography is the design.

**Dark mode:**
- `--bg-app`: #111111
- `--bg-sidebar`: #161616
- `--bg-surface`: #1A1A1A
- `--bg-elevated`: #1E1E1E
- `--bg-hover`: #252525
- `--border`: #2A2A2A
- `--text-primary`: #E8E8E8
- `--text-secondary`: #8B8B8B
- `--text-muted`: #666666
- `--text-ghost`: #444444
- `--accent`: #E8E8E8 (just brighter text, no hue)

**Rating buttons:**
- Again: #8B5C5C (very muted red)
- Hard: #8B7A5C (very muted amber)
- Good: #5C8B6B (very muted green)
- Easy: #5C6B8B (very muted blue)

### Light Mode Strategy
For each theme, invert the gray ramp. Lightest becomes darkest. Keep the same rating button colors but reduce saturation by ~10%. Example for Near-Mono light:
- `--bg-app`: #FAFAFA
- `--bg-sidebar`: #F2F2F2
- `--bg-surface`: #FFFFFF
- `--text-primary`: #1A1A1A
- `--text-secondary`: #6B6B6B
- `--border`: #E0E0E0

### Semantic Colors
- Success: matches each theme's "Good" rating color
- Warning: matches each theme's "Hard" rating color
- Error: matches each theme's "Again" rating color
- Info: matches each theme's "Easy" rating color

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — review needs breathing room
- **Scale:**
  - `--space-2xs`: 2px
  - `--space-xs`: 4px
  - `--space-sm`: 8px
  - `--space-md`: 16px
  - `--space-lg`: 24px
  - `--space-xl`: 32px
  - `--space-2xl`: 48px
  - `--space-3xl`: 64px

## Layout
- **Approach:** Grid-disciplined
- **Structure:** Fixed sidebar (200-220px) + flexible main content area
- **Max content width:** Card display maxes at 480px centered. Browse/search can use full width.
- **Border radius:**
  - `--radius-sm`: 4px (tags, code inline)
  - `--radius-md`: 6px (buttons, inputs, nav items)
  - `--radius-lg`: 10px (cards, panels, mockup containers)
  - No `border-radius: 9999px` pills. Everything has corners.

## Motion
- **Approach:** Minimal-functional
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` for all transitions
- **Duration:**
  - micro: 80ms (hover states)
  - short: 150ms (button press, nav highlight)
  - medium: 250ms (card flip, panel transitions)
- **What animates:** Hover states, card flip, rating button feedback, panel open/close
- **What doesn't:** Page navigation, sidebar, content loading. Instant.

## Anti-Patterns (never do this)
- Purple/violet gradients
- Bright saturated primary buttons (#0066FF, etc.)
- 3-column feature grids with icons in colored circles
- Centered everything with uniform spacing
- Uniform large border-radius on all elements
- Decorative background patterns or blobs
- Emoji as navigation icons in production (use minimal geometric symbols: ◈ ✦ ⌕ ▤)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-06 | Created design system | /design-consultation session. Industrial-Refined aesthetic. |
| 2026-04-06 | Near-Mono chosen initially, then all 3 themes kept | User liked all three equally, decided to ship as switchable themes |
| 2026-04-06 | Rejected bright blue (#0066FF) | "Too jarring, looks like AI slop" — user feedback |
| 2026-04-06 | Satoshi + Geist chosen | Geometric display + screen-optimized body. Avoids overused Inter/Roboto. |
| 2026-04-06 | No decoration | User has high taste, prefers typography-driven design over decorative elements |
