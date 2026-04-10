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
</style>
