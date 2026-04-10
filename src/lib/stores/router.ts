import { writable } from 'svelte/store';

export type Route = 'review' | 'decks' | 'browse' | 'generate' | 'stats' | 'settings';

export const route = writable<Route>('decks');
