<script lang="ts">
  import { theme, type Theme } from '../stores/theme';
  import { shortcuts, formatKey, type RatingKey } from '../stores/shortcuts';
  import { desiredRetention } from '../stores/srs';
  import { cards } from '../stores/data';
  import { cleanUnused, type CleanResult } from '../media';

  const themes: { value: Theme; label: string; description: string }[] = [
    { value: 'system', label: 'System', description: 'Follow OS preference' },
    { value: 'dark', label: 'Dark', description: 'Always dark' },
    { value: 'light', label: 'Light', description: 'Always light' },
  ];

  // Local mirrors so the input can be edited freely; commit on change
  let retentionInput = $state($desiredRetention);
  $effect(() => { retentionInput = $desiredRetention; });
  function commitRetention() {
    desiredRetention.set(retentionInput);
  }

  let maxInterval = $state(36500);

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

  // Shortcut capture state
  let capturing = $state<RatingKey | null>(null);
  let captureError = $state<string | null>(null);

  const ratingRows: { key: RatingKey; label: string; color: string }[] = [
    { key: 'again', label: 'Again', color: 'var(--c-again)' },
    { key: 'hard', label: 'Hard', color: 'var(--c-hard)' },
    { key: 'good', label: 'Good', color: 'var(--c-good)' },
    { key: 'easy', label: 'Easy', color: 'var(--c-easy)' },
  ];

  function startCapture(rating: RatingKey) {
    capturing = rating;
    captureError = null;
  }

  function cancelCapture() {
    capturing = null;
    captureError = null;
  }

  function handleCaptureKey(e: KeyboardEvent) {
    if (!capturing) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      cancelCapture();
      return;
    }

    // Reject pure modifier presses
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

    // Reject conflict with the flip key (Space / Enter)
    if (e.code === 'Space' || e.code === 'Enter') {
      captureError = `${e.code} is reserved for "Show Answer". Pick another key.`;
      return;
    }

    // Reject duplicates with other ratings
    const conflict = (Object.entries($shortcuts) as [RatingKey, string][])
      .find(([r, k]) => r !== capturing && k === e.key);
    if (conflict) {
      captureError = `Already used by "${conflict[0]}". Pick another key.`;
      return;
    }

    shortcuts.setKey(capturing, e.key);
    capturing = null;
    captureError = null;
  }

  function resetShortcuts() {
    shortcuts.reset();
    captureError = null;
    capturing = null;
  }
</script>

<svelte:window onkeydown={handleCaptureKey} />

<div class="settings-page">
  <header class="page-header">
    <h2>Settings</h2>
  </header>

  <section class="settings-section">
    <h3 class="section-title">Appearance</h3>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">Theme</span>
        <span class="setting-desc">Choose your preferred color mode</span>
      </div>
      <div class="theme-switcher">
        {#each themes as t}
          <button
            class="theme-option"
            class:active={$theme === t.value}
            onclick={() => theme.set(t.value)}
          >
            <span class="theme-name">{t.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-header">
      <h3 class="section-title">Review Shortcuts</h3>
      <button class="reset-link" onclick={resetShortcuts}>Reset to defaults</button>
    </div>

    <p class="section-hint">Keys used to rate cards during review. Click a key to change it, then press the new key. Press Esc to cancel.</p>

    <div class="shortcut-list">
      {#each ratingRows as row}
        <div class="shortcut-row">
          <div class="shortcut-info">
            <span class="shortcut-dot" style="background: {row.color}"></span>
            <span class="shortcut-label">{row.label}</span>
          </div>
          <button
            class="shortcut-key"
            class:capturing={capturing === row.key}
            onclick={() => capturing === row.key ? cancelCapture() : startCapture(row.key)}
          >
            {#if capturing === row.key}
              Press a key…
            {:else}
              <kbd>{formatKey($shortcuts[row.key])}</kbd>
            {/if}
          </button>
        </div>
      {/each}
    </div>

    {#if captureError}
      <div class="capture-error">{captureError}</div>
    {/if}
  </section>

  <section class="settings-section">
    <h3 class="section-title">Scheduling</h3>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">Desired retention</span>
        <span class="setting-desc">FSRS target recall probability (0.85–0.97 recommended)</span>
      </div>
      <div class="setting-input">
        <input
          type="number"
          min="0.7"
          max="0.99"
          step="0.01"
          bind:value={retentionInput}
          onchange={commitRetention}
        />
        <span class="input-suffix">{(retentionInput * 100).toFixed(0)}%</span>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">Maximum interval</span>
        <span class="setting-desc">Longest gap between reviews (days)</span>
      </div>
      <div class="setting-input">
        <input
          type="number"
          min="1"
          max="36500"
          bind:value={maxInterval}
        />
        <span class="input-suffix">days</span>
      </div>
    </div>
  </section>

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

  <section class="settings-section">
    <h3 class="section-title">Import</h3>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">Import APKG</span>
        <span class="setting-desc">Import an Anki deck package file</span>
      </div>
      <button class="btn-secondary">
        Choose File...
      </button>
    </div>
  </section>

  <section class="settings-section">
    <h3 class="section-title">About</h3>
    <div class="about-info">
      <span class="about-name">Reki 歴</span>
      <span class="about-version">v0.1.0-dev</span>
      <span class="about-desc">Modern spaced repetition. Open source.</span>
    </div>
  </section>
</div>

<style>
  .settings-page {
    padding: var(--sp-lg);
    max-width: 600px;
    height: 100vh;
    overflow-y: auto;
  }

  .page-header {
    margin-bottom: var(--sp-xl);
  }

  .page-header h2 {
    font-size: var(--text-xl);
  }

  /* Sections */
  .settings-section {
    margin-bottom: var(--sp-xl);
  }

  .section-title {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: var(--sp-md);
    padding-bottom: var(--sp-sm);
    border-bottom: 1px solid var(--border);
  }

  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--sp-md);
    padding-bottom: var(--sp-sm);
    border-bottom: 1px solid var(--border);
  }

  .section-header .section-title {
    margin: 0;
    padding: 0;
    border: none;
  }

  .reset-link {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color var(--dur-micro) var(--ease);
  }

  .reset-link:hover {
    color: var(--accent);
  }

  .section-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: var(--sp-md);
  }

  /* Shortcut list */
  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-sm) var(--sp-md);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }

  .shortcut-info {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .shortcut-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .shortcut-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .shortcut-key {
    padding: var(--sp-xs) var(--sp-sm);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-elevated);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    transition: all var(--dur-micro) var(--ease);
    min-width: 110px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .shortcut-key:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .shortcut-key.capturing {
    border-color: var(--accent);
    background: var(--accent-bg);
    color: var(--accent);
    font-style: italic;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }

  .shortcut-key kbd {
    background: transparent;
    border: none;
    padding: 0;
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 600;
  }

  .capture-error {
    margin-top: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: color-mix(in srgb, var(--c-again) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c-again) 30%, transparent);
    border-radius: var(--r-sm);
    color: var(--c-again);
    font-size: var(--text-xs);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-md) 0;
    gap: var(--sp-lg);
  }

  .setting-row + .setting-row {
    border-top: 1px solid var(--border);
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-label {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-desc {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  /* Theme switcher */
  .theme-switcher {
    display: flex;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
  }

  .theme-option {
    padding: var(--sp-sm) var(--sp-md);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    transition: all var(--dur-micro) var(--ease);
    border-right: 1px solid var(--border);
  }

  .theme-option:last-child {
    border-right: none;
  }

  .theme-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .theme-option.active {
    background: var(--accent-bg);
    color: var(--accent);
  }

  /* Inputs */
  .setting-input {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  .setting-input input {
    width: 100px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .input-suffix {
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .btn-secondary {
    padding: var(--sp-sm) var(--sp-md);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text-secondary);
    font-weight: 500;
    font-size: var(--text-sm);
    transition: all var(--dur-micro) var(--ease);
    white-space: nowrap;
  }

  .btn-secondary:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

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

  /* About */
  .about-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-md) 0;
  }

  .about-name {
    font-family: 'Satoshi', sans-serif;
    font-weight: 700;
    font-size: var(--text-lg);
  }

  .about-version {
    font-family: 'Geist Mono', monospace;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .about-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-top: var(--sp-xs);
  }
</style>
