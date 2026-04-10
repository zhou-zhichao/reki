/**
 * Markdown rendering pipeline for Reki.
 *
 * renderMarkdown  – full async pipeline: marked + KaTeX + Shiki + DOMPurify
 * stripMarkdown   – sync regex-based strip for table row previews
 */

import { marked, type Token, type Tokens } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { renderClozeFront, renderClozeBack } from './cloze';
// DOMPurify needs a window-like object. In the browser it uses globalThis.window;
// in tests (jsdom) globalThis.window is available automatically.

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ImageResolver = (filename: string) => string;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line prefer-const
let imageResolver: ImageResolver = (f) => f;

/** Install a hook that converts bare filenames in ![alt](filename) to URLs. */
export function setImageResolver(fn: ImageResolver): void {
  imageResolver = fn;
}

// Shiki highlighter — lazily created and cached.
// Using `any` here because the shiki package types vary by version and we
// resolve the import dynamically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlighterPromise: Promise<any> | null = null;
const loadedLangs = new Set<string>();
const loadingLangs = new Map<string, Promise<void>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getHighlighter(): Promise<any> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: ['github-dark', 'github-light'], langs: [] }),
    );
  }
  return highlighterPromise;
}

async function ensureLanguageLoaded(lang: string): Promise<void> {
  if (loadedLangs.has(lang)) return;
  const inflight = loadingLangs.get(lang);
  if (inflight) {
    await inflight;
    return;
  }
  const h = await getHighlighter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (h as any).loadLanguage(lang).then(() => {
    loadedLangs.add(lang);
    loadingLangs.delete(lang);
  }).catch((err: unknown) => {
    loadingLangs.delete(lang);
    throw err;
  });
  loadingLangs.set(lang, p);
  await p;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMPurify config
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Configure marked (once, at module load)
// ─────────────────────────────────────────────────────────────────────────────

// KaTeX block extension: $$...$$
const blockMathExtension = {
  name: 'blockMath',
  level: 'block' as const,
  start(src: string): number { return src.indexOf('$$'); },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = src.match(/^\$\$([\s\S]+?)\$\$/);
    if (match) {
      return { type: 'blockMath', raw: match[0], text: match[1].trim() };
    }
    return undefined;
  },
  renderer(token: Tokens.Generic): string {
    try {
      const html = katex.renderToString(token['text'] as string, {
        displayMode: true,
        throwOnError: false,
      });
      return `<div class="math math-display">${html}</div>\n`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `<div class="math math-error">${escapeHtml(msg)}</div>\n`;
    }
  },
};

// KaTeX inline extension: $...$  (no $ or newline inside)
const inlineMathExtension = {
  name: 'inlineMath',
  level: 'inline' as const,
  start(src: string): number { return src.indexOf('$'); },
  tokenizer(src: string): Tokens.Generic | undefined {
    const match = src.match(/^\$(?![\s\d])([^$\n]*?[^\s])\$/);
    if (match) {
      return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
    }
    return undefined;
  },
  renderer(token: Tokens.Generic): string {
    try {
      const html = katex.renderToString(token['text'] as string, {
        displayMode: false,
        throwOnError: false,
      });
      return `<span class="math math-inline">${html}</span>`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `<span class="math math-error">${escapeHtml(msg)}</span>`;
    }
  },
};

marked.use({
  gfm: true,
  breaks: false,
  async: true,
  extensions: [blockMathExtension, inlineMathExtension],

  // walkTokens: pre-render code blocks with Shiki (async)
  async walkTokens(token: Token): Promise<void> {
    if (token.type !== 'code') return;
    const codeToken = token as Tokens.Code & { rendered?: string };
    const lang = (codeToken.lang ?? '').split(/\s+/)[0].toLowerCase();

    try {
      const h = await getHighlighter();
      if (lang) {
        try {
          await ensureLanguageLoaded(lang);
        } catch {
          // Unknown lang — will fall back to plain pre/code
        }
      }

      if (lang && loadedLangs.has(lang)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        codeToken.rendered = (h as any).codeToHtml(codeToken.text, {
          lang,
          theme: 'github-dark',
        });
      }
    } catch {
      // Shiki failure — leave rendered undefined, fallback will run in renderer
    }
  },

  renderer: {
    code(token: Tokens.Code & { rendered?: string }): string {
      if (token.rendered) return token.rendered;
      const lang = token.lang ? ` class="language-${escapeHtml(token.lang)}"` : '';
      return `<pre><code${lang}>${escapeHtml(token.text)}</code></pre>\n`;
    },

    image({ href, title, text }: Tokens.Image): string {
      const resolved = imageResolver(href ?? '');
      const escapedAlt = escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${resolved}" alt="${escapedAlt}"${titleAttr}>`;
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render Markdown to sanitized HTML.
 * Pipeline: marked (with KaTeX math + Shiki code) → DOMPurify
 */
export async function renderMarkdown(src: string): Promise<string> {
  try {
    const raw = await marked(src);
    // DOMPurify works with the global window in browsers; in jsdom it also uses
    // globalThis.window which jsdom sets up automatically.
    const clean = DOMPurify.sanitize(raw, PURIFY_CONFIG);
    return clean as string;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `<div class="md-error">Render failed: ${escapeHtml(msg)}</div>`;
  }
}

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

/**
 * Synchronously strip Markdown to plain text for table row previews.
 * Does NOT call marked — must stay synchronous.
 */
export function stripMarkdown(src: string, maxLen = 120): string {
  if (!src || !src.trim()) return '';

  let s = src;

  // Strip cloze markers → answer text
  s = s.replace(/\{\{c\d+::([^}]*?)(?:::[^}]*?)?\}\}/g, '$1');

  // Fenced code blocks  → space
  s = s.replace(/```[\s\S]*?```/g, ' ');
  // Inline code  → content
  s = s.replace(/`([^`]*)`/g, '$1');
  // Images  → alt text
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links  → text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Bold+italic  ***x*** or ___x___
  s = s.replace(/\*{3}([^*]*)\*{3}/g, '$1');
  s = s.replace(/_{3}([^_]*)_{3}/g, '$1');
  // Bold  **x** or __x__
  s = s.replace(/\*\*([^*]*)\*\*/g, '$1');
  s = s.replace(/__([^_]*)__/g, '$1');
  // Italic  *x* or _x_
  s = s.replace(/\*([^*]*)\*/g, '$1');
  s = s.replace(/_([^_]*)_/g, '$1');
  // Headings  ^#
  s = s.replace(/^#{1,6}\s+/gm, '');
  // Bullets
  s = s.replace(/^[-*+]\s+/gm, '');
  // Ordered list
  s = s.replace(/^\d+\.\s+/gm, '');
  // Blockquote
  s = s.replace(/^>\s+/gm, '');
  // Block math $$...$$ → space
  s = s.replace(/\$\$[\s\S]*?\$\$/g, ' ');
  // Inline math $x$ → content (pandoc convention: no whitespace/digit after opening $)
  s = s.replace(/\$(?![\s\d])([^$\n]*?[^\s])\$/g, '$1');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return '';

  if (s.length > maxLen) {
    s = s.slice(0, maxLen - 1) + '…';
  }

  return s;
}
