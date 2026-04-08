import { writable } from 'svelte/store';

export type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createThemeStore() {
  const stored = (localStorage.getItem('reki-theme') as Theme) || 'system';
  const { subscribe, set } = writable<Theme>(stored);

  function apply(theme: Theme) {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem('reki-theme') as Theme;
    if (current === 'system' || !current) apply('system');
  });

  apply(stored);

  return {
    subscribe,
    set(theme: Theme) {
      localStorage.setItem('reki-theme', theme);
      apply(theme);
      set(theme);
    }
  };
}

export const theme = createThemeStore();
