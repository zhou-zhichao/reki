import { writable } from 'svelte/store';

export type Route = 'review' | 'decks' | 'browse' | 'generate' | 'settings';

export const route = writable<Route>('decks');
