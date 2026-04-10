<script lang="ts">
  import { untrack } from 'svelte';
  import { dueCards, activeDeck, activeDeckId, applyFsrsChoice, cards, notes } from '../stores/data';
  import { route } from '../stores/router';
  import { shortcuts, formatKey, type RatingKey } from '../stores/shortcuts';
  import { fsrsNextStates, desiredRetention, type NextStates } from '../stores/srs';
  import Markdown from '../components/Markdown.svelte';

  let showAnswer = $state(false);
  let currentIndex = $state(0);
  let nextStates = $state<NextStates | null>(null);
  let scheduleError = $state<string | null>(null);

  const currentCard = $derived($dueCards[currentIndex] ?? null);
  const currentNote = $derived(
    currentCard ? $notes.find(n => n.id === currentCard.noteId) ?? null : null
  );
  const isCloze = $derived(currentNote?.noteType === 'cloze');
  const totalDue = $derived($dueCards.length);
  const newCount = $derived($dueCards.filter(c => c.state === 'new').length);

  // Recompute FSRS scheduling whenever the current card changes
  $effect(() => {
    const card = currentCard;
    const retention = $desiredRetention;
    if (!card) {
      nextStates = null;
      return;
    }

    untrack(() => {
      const memory = card.stability != null && card.difficulty != null
        ? { stability: card.stability, difficulty: card.difficulty }
        : null;
      const elapsed = card.lastReview != null
        ? Math.max(0, Math.floor((Date.now() - card.lastReview) / 86_400_000))
        : 0;

      fsrsNextStates(memory, elapsed, retention)
        .then(states => {
          nextStates = states;
          scheduleError = null;
        })
        .catch(err => {
          scheduleError = String(err);
          nextStates = null;
        });
    });
  });

  function flip() {
    showAnswer = true;
  }

  function rate(rating: RatingKey) {
    if (!currentCard || !nextStates) return;
    const choice = nextStates[rating];
    applyFsrsChoice(currentCard.id, rating, {
      interval: choice.interval,
      stability: choice.memory.stability,
      difficulty: choice.memory.difficulty,
    });
    showAnswer = false;
    if (currentIndex >= $dueCards.length) {
      currentIndex = 0;
    }
  }

  function intervalLabel(rating: RatingKey): string {
    if (!nextStates) return '…';
    const days = nextStates[rating].interval;
    if (days < 1) return '<1d';
    if (days === 1) return '1d';
    if (days < 30) return `${days}d`;
    if (days < 365) return `${(days / 30).toFixed(1)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!$activeDeck) return;
    if (!showAnswer) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        flip();
      }
    } else {
      for (const r of (Object.keys($shortcuts) as RatingKey[])) {
        if (e.key === $shortcuts[r]) {
          e.preventDefault();
          rate(r);
          return;
        }
      }
    }
  }

  const ratings = $derived([
    { key: 'again' as const, label: 'Again', color: 'var(--c-again)' },
    { key: 'hard' as const, label: 'Hard', color: 'var(--c-hard)' },
    { key: 'good' as const, label: 'Good', color: 'var(--c-good)' },
    { key: 'easy' as const, label: 'Easy', color: 'var(--c-easy)' },
  ]);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="review-page">
  {#if !$activeDeck}
    <div class="empty-state">
      <div class="empty-icon">◈</div>
      <h3>No deck selected</h3>
      <p>Choose a deck from <button class="link" onclick={() => route.set('decks')}>Decks</button> to start reviewing.</p>
    </div>
  {:else if totalDue === 0}
    <div class="empty-state">
      <div class="empty-icon done">✓</div>
      <h3>You're done for now</h3>
      <p>No cards due in <strong>{$activeDeck.name}</strong>. Come back later or <button class="link" onclick={() => route.set('decks')}>switch decks</button>.</p>
    </div>
  {:else}
    <header class="review-header">
      <div class="deck-name">{$activeDeck.name}</div>
      <div class="review-stats">
        <span>{totalDue} remaining</span>
        {#if newCount > 0}
          <span class="stat-sep">·</span>
          <span class="stat-new">{newCount} new</span>
        {/if}
      </div>
    </header>

    <div class="card-area">
      {#if currentCard}
        <div class="card-content">
          {#if isCloze && currentNote}
            <div class="card-front">
              <Markdown src={currentNote.front} clozeOrdinal={currentCard.ordinal} clozeRevealed={showAnswer} />
            </div>
            {#if showAnswer && currentNote.back}
              <div class="card-divider"></div>
              <div class="card-back"><Markdown src={currentNote.back} /></div>
            {/if}
          {:else}
            <div class="card-front"><Markdown src={currentCard.front} /></div>
            {#if showAnswer}
              <div class="card-divider"></div>
              <div class="card-back"><Markdown src={currentCard.back} /></div>
            {/if}
          {/if}
        </div>

        {#if currentCard.tags.length > 0}
          <div class="card-tags">
            {#each currentCard.tags as tag}
              <span class="tag">{tag}</span>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <footer class="review-footer">
      {#if scheduleError}
        <div class="schedule-error">FSRS error: {scheduleError}</div>
      {/if}
      {#if !showAnswer}
        <button class="show-answer-btn" onclick={flip}>
          Show Answer
          <kbd>Space</kbd>
        </button>
      {:else}
        <div class="rating-bar">
          {#each ratings as r}
            <button
              class="rating-btn"
              style="--btn-color: {r.color}"
              onclick={() => rate(r.key)}
            >
              <span class="rating-label">{r.label}</span>
              <span class="rating-interval">{intervalLabel(r.key)}</span>
              <kbd>{formatKey($shortcuts[r.key])}</kbd>
            </button>
          {/each}
        </div>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .review-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: var(--sp-lg);
  }

  /* Empty state */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-sm);
    color: var(--text-secondary);
  }

  .empty-icon {
    font-size: 3rem;
    color: var(--text-ghost);
    margin-bottom: var(--sp-sm);
  }

  .empty-icon.done {
    color: var(--c-good);
  }

  .empty-state h3 {
    color: var(--text-primary);
    font-size: var(--text-xl);
  }

  .empty-state p {
    font-size: var(--text-sm);
  }

  .link {
    color: var(--accent);
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* Header */
  .review-header {
    display: flex;
    align-items: baseline;
    gap: var(--sp-md);
    padding-bottom: var(--sp-md);
    border-bottom: 1px solid var(--border);
  }

  .deck-name {
    font-family: 'Satoshi', sans-serif;
    font-weight: 700;
    font-size: var(--text-lg);
    color: var(--text-primary);
  }

  .review-stats {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .stat-sep {
    margin: 0 var(--sp-xs);
  }

  .stat-new {
    color: var(--accent);
  }

  /* Card area */
  .card-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--sp-2xl) 0;
    overflow-y: auto;
    min-height: 0;
  }

  .card-content {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .card-front {
    font-family: 'Satoshi', sans-serif;
    font-size: var(--text-2xl);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .card-divider {
    height: 1px;
    background: var(--border);
    margin: var(--sp-lg) 0;
  }

  .card-back {
    font-size: var(--text-lg);
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .card-tags {
    display: flex;
    gap: var(--sp-xs);
    margin-top: var(--sp-lg);
    max-width: 720px;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }

  .tag {
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--bg-elevated);
    padding: 2px 8px;
    border-radius: var(--r-sm);
  }

  /* Footer */
  .review-footer {
    padding-top: var(--sp-lg);
    display: flex;
    justify-content: center;
  }

  .show-answer-btn {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-xl);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: 500;
    transition: all var(--dur-micro) var(--ease);
  }

  .show-answer-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  kbd {
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 1px 5px;
    line-height: 1.4;
  }

  /* Rating bar */
  .rating-bar {
    display: flex;
    gap: var(--sp-sm);
  }

  .rating-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--sp-sm) var(--sp-lg);
    background: color-mix(in srgb, var(--btn-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--btn-color) 25%, transparent);
    border-radius: var(--r-md);
    transition: all var(--dur-micro) var(--ease);
    min-width: 80px;
  }

  .rating-btn:hover {
    background: color-mix(in srgb, var(--btn-color) 22%, transparent);
    border-color: color-mix(in srgb, var(--btn-color) 45%, transparent);
  }

  .rating-label {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--btn-color);
  }

  .rating-interval {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .rating-btn kbd {
    margin-top: 2px;
  }

  .schedule-error {
    margin-bottom: var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: color-mix(in srgb, var(--c-again) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-again) 30%, transparent);
    border-radius: var(--r-md);
    color: var(--c-again);
    font-size: var(--text-xs);
    font-family: 'Geist Mono', monospace;
  }
</style>
