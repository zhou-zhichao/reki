<script lang="ts">
  import { decks, addCardsBulk } from '../stores/data';
  import { invoke } from '@tauri-apps/api/core';
  import Markdown from '../components/Markdown.svelte';

  let prompt = $state('');
  let cardCount = $state(5);
  let selectedDeckId = $state($decks[0]?.id ?? '');
  let generating = $state(false);
  let generatedCards = $state<{ front: string; back: string; selected: boolean }[]>([]);
  let errorMsg = $state<string | null>(null);
  let clozeMode = $state(false);

  async function generate() {
    if (!prompt.trim()) return;
    generating = true;
    errorMsg = null;
    generatedCards = [];

    try {
      const result = await invoke<{ front: string; back: string }[]>('generate_cards', {
        topic: prompt,
        count: cardCount,
        cloze: clozeMode,
      });
      generatedCards = result.map(c => ({ ...c, selected: true }));
    } catch (e) {
      errorMsg = String(e);
    } finally {
      generating = false;
    }
  }

  function toggleCard(i: number) {
    generatedCards[i].selected = !generatedCards[i].selected;
  }

  function addSelected() {
    if (!selectedDeckId) return;
    const toAdd = generatedCards.filter(c => c.selected).map(c => ({ front: c.front, back: c.back }));
    addCardsBulk(selectedDeckId, toAdd, ['ai-generated'], clozeMode ? 'cloze' : 'basic');
    generatedCards = [];
    prompt = '';
  }

  const selectedCount = $derived(generatedCards.filter(c => c.selected).length);
</script>

<div class="generate-page">
  <header class="page-header">
    <h2>Generate</h2>
  </header>

  <div class="gen-form">
    <div class="gen-input-row">
      <textarea
        placeholder="Describe what you want to learn... (e.g., 'JLPT N2 grammar patterns' or 'Rust ownership rules')"
        bind:value={prompt}
        rows="3"
      ></textarea>
    </div>

    <div class="gen-controls">
      <div class="gen-deck-select">
        <label for="gen-deck">Add to</label>
        <select id="gen-deck" bind:value={selectedDeckId}>
          {#each $decks as deck}
            <option value={deck.id}>{deck.name}</option>
          {/each}
        </select>
      </div>

      <div class="gen-deck-select">
        <label for="gen-count">Count</label>
        <input id="gen-count" type="number" min="1" max="20" bind:value={cardCount} class="count-input" />
      </div>

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

      <button
        class="btn-generate"
        onclick={generate}
        disabled={!prompt.trim() || generating}
      >
        {#if generating}
          <span class="spinner"></span>
          Generating...
        {:else}
          ✦ Generate Cards
        {/if}
      </button>
    </div>

    {#if errorMsg}
      <div class="error-box">
        <strong>Generation failed</strong>
        <pre>{errorMsg}</pre>
      </div>
    {/if}
  </div>

  {#if generatedCards.length > 0}
    <div class="gen-results">
      <div class="results-header">
        <span class="results-count">{generatedCards.length} cards generated</span>
        <button class="btn-add" onclick={addSelected} disabled={selectedCount === 0}>
          Add {selectedCount} to deck
        </button>
      </div>

      <div class="card-grid">
        {#each generatedCards as card, i}
          <button
            class="gen-card"
            class:deselected={!card.selected}
            onclick={() => toggleCard(i)}
          >
            <div class="gen-card-check">
              {#if card.selected}
                <span class="check-on">✓</span>
              {:else}
                <span class="check-off">○</span>
              {/if}
            </div>
            <div class="gen-card-content">
              <div class="gen-card-front"><Markdown src={card.front} /></div>
              <div class="gen-card-sep"></div>
              <div class="gen-card-back"><Markdown src={card.back} /></div>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if !generating && generatedCards.length === 0}
    <div class="gen-placeholder">
      <div class="placeholder-icon">✦</div>
      <p>Describe a topic and AI will generate flashcards for you.</p>
      <p class="placeholder-note">Uses Claude API · Cards are previewed before adding</p>
    </div>
  {/if}
</div>

<style>
  .generate-page {
    padding: var(--sp-lg);
    max-width: 720px;
    height: 100vh;
    overflow-y: auto;
  }

  .page-header {
    margin-bottom: var(--sp-lg);
  }

  .page-header h2 {
    font-size: var(--text-xl);
  }

  /* Form */
  .gen-form {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    margin-bottom: var(--sp-lg);
  }

  .gen-input-row textarea {
    width: 100%;
    resize: vertical;
    min-height: 72px;
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .gen-controls {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--sp-md);
  }

  .gen-deck-select {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .gen-deck-select label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .gen-deck-select select {
    padding: var(--sp-sm);
  }

  .count-input {
    width: 72px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .error-box {
    margin-top: var(--sp-md);
    padding: var(--sp-md);
    background: color-mix(in srgb, var(--c-again) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-again) 30%, transparent);
    border-radius: var(--r-md);
    color: var(--c-again);
    font-size: var(--text-sm);
  }

  .error-box strong {
    display: block;
    margin-bottom: var(--sp-xs);
  }

  .error-box pre {
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .btn-generate {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-lg);
    background: var(--accent);
    color: var(--bg-app);
    border-radius: var(--r-md);
    font-weight: 600;
    font-size: var(--text-sm);
    transition: opacity var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .btn-generate:hover:not(:disabled) { opacity: 0.85; }
  .btn-generate:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Results */
  .gen-results {
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
  }

  .results-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .results-count {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .btn-add {
    padding: var(--sp-xs) var(--sp-md);
    background: var(--c-good);
    color: #fff;
    border-radius: var(--r-md);
    font-weight: 600;
    font-size: var(--text-sm);
    transition: opacity var(--dur-micro) var(--ease);
  }

  .btn-add:hover:not(:disabled) { opacity: 0.85; }
  .btn-add:disabled { opacity: 0.4; cursor: not-allowed; }

  .card-grid {
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
  }

  .gen-card {
    display: flex;
    gap: var(--sp-md);
    padding: var(--sp-md);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    text-align: left;
    width: 100%;
    transition: all var(--dur-micro) var(--ease);
  }

  .gen-card:hover {
    border-color: var(--border-strong);
  }

  .gen-card.deselected {
    opacity: 0.45;
  }

  .gen-card-check {
    flex-shrink: 0;
    width: 20px;
    padding-top: 2px;
  }

  .check-on {
    color: var(--c-good);
    font-weight: 700;
  }

  .check-off {
    color: var(--text-ghost);
  }

  .gen-card-content {
    flex: 1;
    min-width: 0;
  }

  .gen-card-front {
    font-weight: 600;
    font-size: var(--text-base);
    color: var(--text-primary);
    margin-bottom: var(--sp-sm);
  }

  .gen-card-sep {
    height: 1px;
    background: var(--border);
    margin-bottom: var(--sp-sm);
  }

  .gen-card-back {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  /* Placeholder */
  .gen-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--sp-3xl) 0;
    gap: var(--sp-sm);
    color: var(--text-secondary);
    text-align: center;
  }

  .placeholder-icon {
    font-size: 3rem;
    color: var(--text-ghost);
    margin-bottom: var(--sp-sm);
  }

  .placeholder-note {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

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
</style>
