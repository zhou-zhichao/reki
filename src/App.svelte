<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import ReviewPage from './lib/pages/ReviewPage.svelte';
  import DecksPage from './lib/pages/DecksPage.svelte';
  import BrowsePage from './lib/pages/BrowsePage.svelte';
  import GeneratePage from './lib/pages/GeneratePage.svelte';
  import StatsPage from './lib/pages/StatsPage.svelte';
  import SettingsPage from './lib/pages/SettingsPage.svelte';
  import { route } from './lib/stores/router';
  import { loadFromDb, dataLoaded } from './lib/stores/data';
  import { initMediaPaths, toAssetUrlSync } from './lib/media';
  import { setImageResolver } from './lib/markdown';

  onMount(async () => {
    await initMediaPaths();
    setImageResolver((filename) => toAssetUrlSync(filename));
    loadFromDb();
  });
</script>

<div class="app-shell">
  <Sidebar />
  <main class="main-content">
    {#if !$dataLoaded}
      <div class="loading">
        <div class="loading-mark">歴</div>
      </div>
    {:else if $route === 'review'}
      <ReviewPage />
    {:else if $route === 'decks'}
      <DecksPage />
    {:else if $route === 'browse'}
      <BrowsePage />
    {:else if $route === 'generate'}
      <GeneratePage />
    {:else if $route === 'stats'}
      <StatsPage />
    {:else if $route === 'settings'}
      <SettingsPage />
    {/if}
  </main>
</div>

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .loading {
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loading-mark {
    font-family: 'Satoshi', sans-serif;
    font-weight: 700;
    font-size: 4rem;
    color: var(--accent);
    opacity: 0.4;
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }
</style>
