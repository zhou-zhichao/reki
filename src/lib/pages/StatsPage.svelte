<script lang="ts">
  import { activeDeck, activeDeckId } from '../stores/data';
  import {
    statsRange, statsScope, cardCounts, intervalBuckets, futureDue,
    reviewStats, fetchReviewStats, filteredCards,
  } from '../stores/stats';
  import type { StatsRange } from '../stats';
  import StatCard from '../components/charts/StatCard.svelte';
  import BarChart from '../components/charts/BarChart.svelte';
  import DonutChart from '../components/charts/DonutChart.svelte';

  const ranges: { value: StatsRange; label: string }[] = [
    { value: '1m', label: '1M' },
    { value: '3m', label: '3M' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
  ];

  // Fetch review stats when range/scope/deck changes
  $effect(() => {
    const range = $statsRange;
    const scope = $statsScope;
    const deckId = $activeDeckId;
    fetchReviewStats(range, scope, deckId);
  });

  // Today overview
  const todayCount = $derived($reviewStats?.todayCount ?? 0);
  const todayCorrect = $derived($reviewStats?.todayCorrect ?? 0);
  const todayAgain = $derived($reviewStats?.todayAgain ?? 0);
  const correctPct = $derived(
    todayCount > 0 ? ((todayCorrect / todayCount) * 100).toFixed(1) + '%' : '—'
  );

  const avgInterval = $derived.by(() => {
    const reviewCards = $filteredCards.filter(c => c.state === 'review');
    if (reviewCards.length === 0) return '—';
    const avg = reviewCards.reduce((s, c) => s + c.interval, 0) / reviewCards.length;
    return avg.toFixed(1) + 'd';
  });

  // Future due chart data
  const futureDueBars = $derived(
    $futureDue.map(d => ({
      label: d.day === 0 ? 'Today' : `+${d.day}`,
      segments: [
        { value: d.young, color: 'var(--accent)' },
        { value: d.mature, color: 'var(--text-muted)' },
      ],
    }))
  );

  // Calendar chart data (daily review counts)
  const calendarBars = $derived(
    ($reviewStats?.dailyCounts ?? []).map(d => ({
      label: d.date.slice(5), // "MM-DD"
      segments: [
        { value: d.again, color: 'var(--c-again)' },
        { value: d.hard, color: 'var(--c-hard)' },
        { value: d.good, color: 'var(--c-good)' },
        { value: d.easy, color: 'var(--c-easy)' },
      ],
    }))
  );

  // Interval histogram
  const intervalBars = $derived(
    $intervalBuckets.map(b => ({
      label: b.label,
      segments: [{ value: b.count, color: 'var(--accent)' }],
    }))
  );

  // Card counts donut
  const donutSegments = $derived([
    { label: 'New', value: $cardCounts.new, color: 'var(--accent)' },
    { label: 'Learning', value: $cardCounts.learning, color: 'var(--c-hard)' },
    { label: 'Young', value: $cardCounts.young, color: 'var(--c-good)' },
    { label: 'Mature', value: $cardCounts.mature, color: 'var(--text-muted)' },
    { label: 'Suspended', value: $cardCounts.suspended, color: 'var(--c-again)' },
  ]);

  // Answer buttons (stacked)
  const answerBars = $derived(
    ($reviewStats?.dailyCounts ?? []).map(d => ({
      label: d.date.slice(5),
      segments: [
        { value: d.again, color: 'var(--c-again)' },
        { value: d.hard, color: 'var(--c-hard)' },
        { value: d.good, color: 'var(--c-good)' },
        { value: d.easy, color: 'var(--c-easy)' },
      ],
    }))
  );
</script>

<div class="stats-page">
  <header class="stats-header">
    <h2>Stats</h2>
    <div class="stats-controls">
      <div class="scope-toggle">
        <button
          class="toggle-btn"
          class:active={$statsScope === 'deck'}
          onclick={() => statsScope.set('deck')}
        >
          {$activeDeck?.name ?? 'No deck'}
        </button>
        <button
          class="toggle-btn"
          class:active={$statsScope === 'all'}
          onclick={() => statsScope.set('all')}
        >
          All Decks
        </button>
      </div>

      <div class="range-toggle">
        {#each ranges as r}
          <button
            class="range-btn"
            class:active={$statsRange === r.value}
            onclick={() => statsRange.set(r.value)}
          >
            {r.label}
          </button>
        {/each}
      </div>
    </div>
  </header>

  {#if $filteredCards.length === 0}
    <div class="empty-state">
      <div class="empty-icon">▦</div>
      <h3>No cards</h3>
      <p>Add cards to see statistics.</p>
    </div>
  {:else}
    <!-- Today Overview -->
    <section class="stats-section">
      <h3>Today</h3>
      <div class="stat-row">
        <StatCard label="Reviews" value={String(todayCount)} />
        <StatCard label="Correct" value={correctPct} />
        <StatCard label="Again" value={String(todayAgain)} />
        <StatCard label="Avg Interval" value={avgInterval} />
      </div>
    </section>

    <!-- Future Due -->
    <section class="stats-section">
      <h3>Future Due</h3>
      {#if futureDueBars.some(b => b.segments.some(s => s.value > 0))}
        <BarChart bars={futureDueBars} stacked />
      {:else}
        <p class="no-data">No upcoming reviews</p>
      {/if}
    </section>

    <!-- Reviews Per Day -->
    <section class="stats-section">
      <h3>Reviews Per Day</h3>
      {#if calendarBars.length > 0}
        <BarChart bars={calendarBars} stacked />
      {:else}
        <p class="no-data">Start reviewing to see history</p>
      {/if}
    </section>

    <div class="stats-grid">
      <!-- Intervals -->
      <section class="stats-section">
        <h3>Intervals</h3>
        <BarChart bars={intervalBars} />
      </section>

      <!-- Card Counts -->
      <section class="stats-section">
        <h3>Card Counts</h3>
        <DonutChart segments={donutSegments} centerLabel={String($cardCounts.total)} />
      </section>
    </div>

    <!-- Answer Buttons -->
    <section class="stats-section">
      <h3>Answer Buttons</h3>
      {#if answerBars.length > 0}
        <BarChart bars={answerBars} stacked />
      {:else}
        <p class="no-data">Start reviewing to see rating distribution</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .stats-page {
    padding: var(--sp-lg);
    max-width: 900px;
    height: 100vh;
    overflow-y: auto;
  }

  .stats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-lg);
    gap: var(--sp-md);
  }

  .stats-header h2 {
    font-size: var(--text-xl);
    flex-shrink: 0;
  }

  .stats-controls {
    display: flex;
    gap: var(--sp-md);
  }

  .scope-toggle,
  .range-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
  }

  .toggle-btn,
  .range-btn {
    padding: var(--sp-xs) var(--sp-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    border-right: 1px solid var(--border);
    transition: all var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .toggle-btn:last-child,
  .range-btn:last-child {
    border-right: none;
  }

  .toggle-btn:hover,
  .range-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toggle-btn.active,
  .range-btn.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  .stats-section {
    margin-bottom: var(--sp-xl);
  }

  .stats-section h3 {
    font-family: 'Satoshi', sans-serif;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: var(--sp-md);
  }

  .stat-row {
    display: flex;
    gap: var(--sp-sm);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-lg);
  }

  .no-data {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-style: italic;
    padding: var(--sp-lg) 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-sm);
    padding: var(--sp-3xl) 0;
    color: var(--text-secondary);
  }

  .empty-icon {
    font-size: 3rem;
    color: var(--text-ghost);
    margin-bottom: var(--sp-sm);
  }

  .empty-state h3 {
    color: var(--text-primary);
    font-size: var(--text-xl);
  }
</style>
