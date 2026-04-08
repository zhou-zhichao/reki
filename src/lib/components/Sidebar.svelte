<script lang="ts">
  import { route, type Route } from '../stores/router';
  import { cards, decks } from '../stores/data';

  let collapsed = $state(false);

  const navItems: { id: Route; label: string; icon: string }[] = [
    { id: 'review', label: 'Review', icon: '◈' },
    { id: 'decks', label: 'Decks', icon: '▤' },
    { id: 'browse', label: 'Browse', icon: '⌕' },
    { id: 'generate', label: 'Generate', icon: '✦' },
  ];

  const totalDue = $derived(
    $cards.filter(c => c.due <= Date.now()).length
  );
</script>

<aside class="sidebar" class:collapsed>
  <div class="sidebar-header">
    <button class="logo" onclick={() => collapsed = !collapsed}>
      <span class="logo-mark">歴</span>
      {#if !collapsed}
        <span class="logo-text">REKI</span>
      {/if}
    </button>
  </div>

  <nav class="sidebar-nav">
    {#each navItems as item}
      <button
        class="nav-item"
        class:active={$route === item.id}
        onclick={() => route.set(item.id)}
        title={collapsed ? item.label : undefined}
      >
        <span class="nav-icon">{item.icon}</span>
        {#if !collapsed}
          <span class="nav-label">{item.label}</span>
          {#if item.id === 'review' && totalDue > 0}
            <span class="nav-badge">{totalDue}</span>
          {/if}
          {#if item.id === 'decks'}
            <span class="nav-count">{$decks.length}</span>
          {/if}
        {/if}
      </button>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <button
      class="nav-item"
      class:active={$route === 'settings'}
      onclick={() => route.set('settings')}
      title={collapsed ? 'Settings' : undefined}
    >
      <span class="nav-icon">⚙</span>
      {#if !collapsed}
        <span class="nav-label">Settings</span>
      {/if}
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-w);
    height: 100vh;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    transition: width var(--dur-medium) var(--ease);
    user-select: none;
    flex-shrink: 0;
  }

  .sidebar.collapsed {
    width: 56px;
  }

  .sidebar-header {
    padding: var(--sp-md);
    padding-bottom: var(--sp-sm);
  }

  .logo {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-xs);
    font-size: var(--text-base);
    transition: opacity var(--dur-micro) var(--ease);
  }

  .logo:hover {
    opacity: 0.7;
  }

  .logo-mark {
    font-family: 'Satoshi', sans-serif;
    font-weight: 700;
    font-size: var(--text-xl);
    color: var(--accent);
    line-height: 1;
  }

  .logo-text {
    font-family: 'Satoshi', sans-serif;
    font-weight: 700;
    font-size: var(--text-sm);
    letter-spacing: 0.12em;
    color: var(--text-secondary);
  }

  .sidebar-nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2xs);
    padding: var(--sp-sm) var(--sp-sm);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-sm);
    border-radius: var(--r-md);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: all var(--dur-micro) var(--ease);
    width: 100%;
    text-align: left;
  }

  .nav-item:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .nav-item.active {
    color: var(--accent);
    background: var(--accent-bg);
  }

  .nav-icon {
    width: 20px;
    text-align: center;
    font-size: var(--text-base);
    flex-shrink: 0;
  }

  .nav-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
  }

  .nav-badge {
    background: var(--accent);
    color: var(--bg-app);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    line-height: 1.4;
  }

  .nav-count {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .sidebar-footer {
    padding: var(--sp-sm);
    border-top: 1px solid var(--border);
  }
</style>
