<script lang="ts">
  import { decks, cards, activeDeckId, addDeck, deleteDeck } from '../stores/data';
  import { route } from '../stores/router';

  let newDeckName = $state('');
  let showNewDeck = $state(false);

  function deckStats(deckId: string) {
    const deckCards = $cards.filter(c => c.deckId === deckId);
    const now = Date.now();
    return {
      total: deckCards.length,
      new: deckCards.filter(c => c.state === 'new').length,
      due: deckCards.filter(c => c.due <= now).length,
      review: deckCards.filter(c => c.state === 'review' && c.due <= now).length,
    };
  }

  function createDeck() {
    const name = newDeckName.trim();
    if (!name) return;
    addDeck(name);
    newDeckName = '';
    showNewDeck = false;
  }

  function selectDeck(id: string) {
    activeDeckId.set(id);
    route.set('review');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && showNewDeck) createDeck();
    if (e.key === 'Escape') showNewDeck = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="decks-page">
  <header class="page-header">
    <h2>Decks</h2>
    <button class="btn-secondary" onclick={() => showNewDeck = !showNewDeck}>
      {showNewDeck ? 'Cancel' : '+ New Deck'}
    </button>
  </header>

  {#if showNewDeck}
    <div class="new-deck-form">
      <input
        type="text"
        placeholder="Deck name..."
        bind:value={newDeckName}
        autofocus
      />
      <button class="btn-primary" onclick={createDeck} disabled={!newDeckName.trim()}>
        Create
      </button>
    </div>
  {/if}

  <div class="deck-list">
    {#each $decks as deck (deck.id)}
      {@const stats = deckStats(deck.id)}
      <div class="deck-row" onclick={() => selectDeck(deck.id)} role="button" tabindex="0" onkeydown={(e) => { if (e.key === 'Enter') selectDeck(deck.id); }}>
        <div class="deck-info">
          <span class="deck-name">{deck.name}</span>
          <span class="deck-total">{stats.total} cards</span>
        </div>
        <div class="deck-stats">
          {#if stats.new > 0}
            <span class="stat stat-new">{stats.new}</span>
          {/if}
          {#if stats.due > 0}
            <span class="stat stat-due">{stats.due}</span>
          {/if}
          {#if stats.new === 0 && stats.due === 0}
            <span class="stat stat-done">✓</span>
          {/if}
        </div>
        <button
          class="deck-delete"
          onclick={(e) => { e.stopPropagation(); deleteDeck(deck.id); }}
          title="Delete deck"
        >×</button>
      </div>
    {:else}
      <div class="empty-state">
        <div class="empty-icon">▤</div>
        <h3>No decks yet</h3>
        <p>Create your first deck to get started.</p>
      </div>
    {/each}
  </div>
</div>

<style>
  .decks-page {
    padding: var(--sp-lg);
    max-width: 640px;
    height: 100vh;
    overflow-y: auto;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-lg);
  }

  .page-header h2 {
    font-size: var(--text-xl);
  }

  .btn-secondary {
    padding: var(--sp-xs) var(--sp-md);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-secondary);
    font-weight: 500;
    transition: all var(--dur-micro) var(--ease);
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .btn-primary {
    padding: var(--sp-xs) var(--sp-md);
    background: var(--accent);
    color: var(--bg-app);
    border-radius: var(--r-md);
    font-weight: 600;
    transition: opacity var(--dur-micro) var(--ease);
  }

  .btn-primary:hover { opacity: 0.85; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .new-deck-form {
    display: flex;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-lg);
  }

  .new-deck-form input {
    flex: 1;
  }

  /* Deck list */
  .deck-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .deck-row {
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    padding: var(--sp-md);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    transition: all var(--dur-micro) var(--ease);
    text-align: left;
    width: 100%;
  }

  .deck-row:hover {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
  }

  .deck-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .deck-name {
    font-family: 'Satoshi', sans-serif;
    font-weight: 600;
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  .deck-total {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .deck-stats {
    display: flex;
    gap: var(--sp-sm);
  }

  .stat {
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 2px 8px;
    border-radius: var(--r-sm);
  }

  .stat-new {
    color: var(--accent);
    background: var(--accent-bg);
  }

  .stat-due {
    color: var(--c-good);
    background: color-mix(in srgb, var(--c-good) 12%, transparent);
  }

  .stat-done {
    color: var(--text-muted);
  }

  .deck-delete {
    color: var(--text-ghost);
    font-size: var(--text-lg);
    padding: var(--sp-xs);
    border-radius: var(--r-sm);
    opacity: 0;
    transition: all var(--dur-micro) var(--ease);
  }

  .deck-row:hover .deck-delete {
    opacity: 1;
  }

  .deck-delete:hover {
    color: var(--c-again);
    background: color-mix(in srgb, var(--c-again) 12%, transparent);
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--sp-3xl) 0;
    gap: var(--sp-sm);
    color: var(--text-secondary);
  }

  .empty-icon {
    font-size: 3rem;
    color: var(--text-ghost);
  }

  .empty-state h3 {
    color: var(--text-primary);
  }

  .empty-state p {
    font-size: var(--text-sm);
  }
</style>
