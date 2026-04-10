<script lang="ts">
  import { cards, decks, activeDeckId, updateCard, deleteCard, notes, updateNote, deleteNote, type Card, type Note } from '../stores/data';
  import { parseQuery } from '../query';
  import MarkdownEditor from '../components/MarkdownEditor.svelte';
  import { stripMarkdown } from '../markdown';

  let search = $state('');
  let selectedId = $state<string | null>(null);
  let editFront = $state('');
  let editBack = $state('');
  let showHelp = $state(false);

  const parsed = $derived(parseQuery(search));

  const filtered = $derived(
    parsed.matches($cards, { decks: $decks, notes: $notes, now: Date.now(), currentDeckId: $activeDeckId })
  );

  const selectedCard = $derived(filtered.find(c => c.id === selectedId) ?? null);

  const selectedNote = $derived(
    selectedCard ? $notes.find(n => n.id === selectedCard.noteId) ?? null : null
  );

  function selectCard(card: Card) {
    selectedId = card.id;
    editFront = card.front;
    editBack = card.back;
  }

  function saveEdit() {
    if (!selectedId || !selectedNote) return;
    updateNote(selectedNote.id, { front: editFront, back: editBack });
  }

  function removeCard() {
    if (!selectedId || !selectedNote) return;
    deleteNote(selectedNote.id);
    selectedId = null;
  }

  function getDeckName(deckId: string): string {
    return $decks.find(d => d.id === deckId)?.name ?? 'Unknown';
  }

  function stateLabel(state: string): string {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  const FLAG_COLORS = ['', '#C45C5C', '#D89A4A', '#5CA06A', '#5A80B0', '#C46AA0', '#5AB0B0', '#9A6AC4'];
  const FLAG_NAMES = ['', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];
</script>

<div class="browse-page">
  <div class="browse-main">
    <header class="page-header">
      <h2>Browse</h2>
      <div class="search-wrap">
        <div class="search-bar">
          <span class="search-icon">⌕</span>
          <input
            type="text"
            placeholder='deck:japanese is:due  ·  tag:vocab  ·  -is:new  ·  "exact phrase"'
            bind:value={search}
          />
          {#if search}
            <button class="search-clear" onclick={() => search = ''}>×</button>
          {/if}
          <button
            class="search-help"
            class:active={showHelp}
            onclick={() => showHelp = !showHelp}
            title="Query syntax help"
          >?</button>
        </div>
        <div class="result-count">
          {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
        </div>
      </div>
    </header>

    {#if parsed.error}
      <div class="query-error">
        <span class="error-label">Query error:</span> {parsed.error}
      </div>
    {/if}

    {#if showHelp}
      <div class="help-panel">
        <div class="help-grid">
          <div class="help-col">
            <h5>Fields</h5>
            <ul>
              <li><code>deck:</code><i>name</i> — deck (matches descendants)</li>
              <li><code>deck:current</code> — active deck</li>
              <li><code>tag:</code><i>name</i> — has tag (matches subtags)</li>
              <li><code>tag:none</code> — has no tags</li>
              <li><code>front:</code><i>text</i> — front field (exact)</li>
              <li><code>back:</code><i>text</i> — back field (exact)</li>
              <li><code>flag:</code><i>0–7</i> — flag color</li>
              <li><code>added:</code><i>N</i> — created in last N days</li>
              <li><code>edited:</code><i>N</i> — edited in last N days</li>
              <li><code>cid:</code><i>id1,id2</i> — card id list</li>
            </ul>

            <h5>State (is:)</h5>
            <ul>
              <li><code>is:new</code> — never reviewed</li>
              <li><code>is:due</code> — due now</li>
              <li><code>is:review</code> — in review</li>
              <li><code>is:learning</code> — relearning</li>
              <li><code>is:suspended</code> — suspended</li>
              <li><code>is:buried</code> — buried</li>
            </ul>
          </div>

          <div class="help-col">
            <h5>Property comparison</h5>
            <ul>
              <li><code>prop:ivl&gt;=10</code> — interval (days)</li>
              <li><code>prop:due=0</code> — due today</li>
              <li><code>prop:due&lt;-7</code> — overdue 7+ days</li>
              <li><code>prop:reps&lt;5</code> — review count</li>
              <li><code>prop:lapses&gt;3</code> — lapse count</li>
              <li><code>prop:ease!=2.5</code> — ease factor</li>
              <li><i>Operators:</i> &lt; &lt;= &gt; &gt;= = !=</li>
            </ul>

            <h5>Special</h5>
            <ul>
              <li><code>re:</code><i>pattern</i> — regex search</li>
              <li><code>nc:</code><i>uber</i> — ignore diacritics ("über")</li>
              <li><code>w:</code><i>dog</i> — word boundary</li>
              <li><code>*</code> <code>_</code> — wildcards (zero+ / one)</li>
            </ul>

            <h5>Operators</h5>
            <ul>
              <li><code>a b</code> — AND (implicit)</li>
              <li><code>a OR b</code> — OR</li>
              <li><code>-term</code> — NOT</li>
              <li><code>"phrase"</code> — quoted</li>
              <li><code>(a OR b) c</code> — grouping</li>
            </ul>
          </div>
        </div>

        <div class="help-examples">
          <h5>Examples (click to use)</h5>
          <div class="example-grid">
            {#each [
              'deck:japanese is:due',
              'tag:vocab -is:new',
              'front:"食べ物"',
              'flag:1 OR flag:2',
              'added:7',
              'prop:lapses>0 prop:ivl<7',
              '(deck:rust OR deck:go) is:due',
              're:"^[a-z]"'
            ] as ex}
              <button class="example-btn" onclick={() => { search = ex; showHelp = false; }}>{ex}</button>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-flag"></th>
            <th class="col-type">Type</th>
            <th class="col-front">Front</th>
            <th class="col-deck">Deck</th>
            <th class="col-state">State</th>
            <th class="col-due">Due</th>
            <th class="col-interval">Interval</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as card (card.id)}
            <tr
              class:selected={card.id === selectedId}
              onclick={() => selectCard(card)}
            >
              <td class="col-flag">
                {#if card.flag > 0}
                  <span class="flag-dot" style="background: {FLAG_COLORS[card.flag]}" title={FLAG_NAMES[card.flag]}></span>
                {/if}
              </td>
              <td class="col-type">
                <span class="type-badge" class:cloze={$notes.find(n => n.id === card.noteId)?.noteType === 'cloze'}>
                  {$notes.find(n => n.id === card.noteId)?.noteType === 'cloze' ? 'Cloze' : 'Basic'}
                </span>
              </td>
              <td class="col-front">{stripMarkdown(card.front, 80)}</td>
              <td class="col-deck">{getDeckName(card.deckId)}</td>
              <td class="col-state">
                <span class="state-badge" class:new={card.state === 'new'} class:learning={card.state === 'learning'} class:review={card.state === 'review'}>
                  {stateLabel(card.state)}
                </span>
              </td>
              <td class="col-due">{card.due <= Date.now() ? 'Now' : new Date(card.due).toLocaleDateString()}</td>
              <td class="col-interval">{card.interval === 0 ? '—' : `${card.interval}d`}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="no-results">No cards found</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if selectedCard}
    <aside class="detail-panel">
      <div class="detail-header">
        <h4>{selectedNote?.noteType === 'cloze' ? 'Edit Cloze Note' : 'Edit Card'}</h4>
        <button class="close-btn" onclick={() => selectedId = null}>×</button>
      </div>

      <div class="detail-field">
        <label>Front</label>
        <MarkdownEditor bind:value={editFront} label="Front" rows={3} />
      </div>

      <div class="detail-field">
        <label>Back</label>
        <MarkdownEditor bind:value={editBack} label="Back" rows={5} />
      </div>

      <div class="detail-meta">
        <div class="meta-row">
          <span class="meta-label">Deck</span>
          <span>{getDeckName(selectedCard.deckId)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Reps</span>
          <span>{selectedCard.reps}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Lapses</span>
          <span>{selectedCard.lapses}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Ease</span>
          <span>{(selectedCard.ease * 100).toFixed(0)}%</span>
        </div>
        {#if selectedNote?.noteType === 'cloze'}
          <div class="meta-row">
            <span class="meta-label">Cards</span>
            <span>{$cards.filter(c => c.noteId === selectedNote?.id).length} cloze cards</span>
          </div>
        {/if}
        {#if selectedCard.tags.length > 0}
          <div class="meta-row">
            <span class="meta-label">Tags</span>
            <span class="tag-list">
              {#each selectedCard.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </span>
          </div>
        {/if}
      </div>

      <div class="detail-actions">
        <button class="btn-primary" onclick={saveEdit}>Save</button>
        <button class="btn-danger" onclick={removeCard}>Delete</button>
      </div>
    </aside>
  {/if}
</div>

<style>
  .browse-page {
    display: flex;
    height: 100vh;
  }

  .browse-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--sp-lg);
    min-width: 0;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--sp-lg);
    gap: var(--sp-md);
  }

  .page-header h2 {
    font-size: var(--text-xl);
    flex-shrink: 0;
  }

  .search-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    max-width: 720px;
  }

  .search-bar {
    position: relative;
    flex: 1;
  }

  .search-icon {
    position: absolute;
    left: var(--sp-sm);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    font-size: var(--text-sm);
    pointer-events: none;
  }

  .search-bar input {
    width: 100%;
    padding-left: var(--sp-xl);
    padding-right: 60px;
    font-family: 'Geist Mono', 'Geist', monospace;
    font-size: var(--text-sm);
  }

  .search-clear {
    position: absolute;
    right: 32px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    font-size: var(--text-lg);
    padding: 2px;
  }

  .search-clear:hover {
    color: var(--text-primary);
  }

  .search-help {
    position: absolute;
    right: var(--sp-sm);
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--dur-micro) var(--ease);
  }

  .search-help:hover,
  .search-help.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent);
  }

  .result-count {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Help panel */
  .help-panel {
    margin-bottom: var(--sp-lg);
    padding: var(--sp-md);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
  }

  .help-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-lg);
  }

  .help-col h5 {
    font-family: 'Geist', sans-serif;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--sp-sm);
  }

  .help-col h5:not(:first-child) {
    margin-top: var(--sp-md);
  }

  .help-col ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2xs);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .help-col code {
    color: var(--accent);
    background: var(--accent-bg);
    padding: 0 4px;
    border-radius: var(--r-sm);
    font-size: var(--text-xs);
  }

  .help-col i {
    color: var(--text-muted);
    font-style: italic;
  }

  .help-examples {
    margin-top: var(--sp-md);
    padding-top: var(--sp-md);
    border-top: 1px solid var(--border);
  }

  .help-examples h5 {
    font-family: 'Geist', sans-serif;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--sp-sm);
  }

  .example-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-xs);
  }

  .example-btn {
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-elevated);
    padding: var(--sp-xs) var(--sp-sm);
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all var(--dur-micro) var(--ease);
    text-align: left;
  }

  .example-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-bg);
  }

  .query-error {
    margin-bottom: var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: color-mix(in srgb, var(--c-again) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-again) 30%, transparent);
    border-radius: var(--r-md);
    font-size: var(--text-sm);
    color: var(--c-again);
  }

  .error-label {
    font-weight: 600;
  }

  /* Table */
  .table-wrap {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  th {
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-family: 'Geist', sans-serif;
    font-weight: 500;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: left;
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-flag { width: 24px; padding-right: 0; }
  .flag-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    vertical-align: middle;
  }

  .col-front { max-width: 300px; }
  .col-deck { color: var(--text-secondary); }
  .col-due { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .col-interval { font-variant-numeric: tabular-nums; color: var(--text-muted); }

  tbody tr {
    cursor: pointer;
    transition: background var(--dur-micro) var(--ease);
  }

  tbody tr:hover {
    background: var(--bg-hover);
  }

  tbody tr.selected {
    background: var(--accent-bg);
  }

  .state-badge {
    font-size: var(--text-xs);
    font-weight: 500;
    padding: 1px 6px;
    border-radius: var(--r-sm);
  }

  .state-badge.new {
    color: var(--accent);
    background: var(--accent-bg);
  }

  .state-badge.learning {
    color: var(--c-hard);
    background: color-mix(in srgb, var(--c-hard) 12%, transparent);
  }

  .state-badge.review {
    color: var(--c-good);
    background: color-mix(in srgb, var(--c-good) 12%, transparent);
  }

  .no-results {
    text-align: center;
    color: var(--text-muted);
    padding: var(--sp-2xl) !important;
  }

  /* Detail panel */
  .detail-panel {
    width: 320px;
    border-left: 1px solid var(--border);
    background: var(--bg-surface);
    padding: var(--sp-lg);
    display: flex;
    flex-direction: column;
    gap: var(--sp-md);
    overflow-y: auto;
    flex-shrink: 0;
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .detail-header h4 {
    font-size: var(--text-base);
  }

  .close-btn {
    color: var(--text-muted);
    font-size: var(--text-lg);
    padding: var(--sp-xs);
    border-radius: var(--r-sm);
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .detail-field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .detail-field label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .detail-field textarea {
    resize: vertical;
    min-height: 60px;
    line-height: 1.5;
  }

  .detail-meta {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    padding: var(--sp-md) 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
  }

  .meta-label {
    color: var(--text-muted);
  }

  .tag-list {
    display: flex;
    gap: var(--sp-xs);
    flex-wrap: wrap;
  }

  .tag {
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--bg-elevated);
    padding: 1px 6px;
    border-radius: var(--r-sm);
  }

  .detail-actions {
    display: flex;
    gap: var(--sp-sm);
  }

  .btn-primary {
    flex: 1;
    padding: var(--sp-sm);
    background: var(--accent);
    color: var(--bg-app);
    border-radius: var(--r-md);
    font-weight: 600;
    transition: opacity var(--dur-micro) var(--ease);
  }

  .btn-primary:hover { opacity: 0.85; }

  .btn-danger {
    padding: var(--sp-sm) var(--sp-md);
    color: var(--c-again);
    border: 1px solid color-mix(in srgb, var(--c-again) 25%, transparent);
    border-radius: var(--r-md);
    font-weight: 500;
    transition: all var(--dur-micro) var(--ease);
  }

  .btn-danger:hover {
    background: color-mix(in srgb, var(--c-again) 12%, transparent);
  }

  .col-type { width: 60px; }

  .type-badge {
    font-size: var(--text-xs);
    font-weight: 500;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    color: var(--text-muted);
  }

  .type-badge.cloze {
    color: var(--accent);
    background: var(--accent-bg);
  }
</style>
