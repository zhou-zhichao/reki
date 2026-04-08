import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

// ─── Settings ────────────────────────────────────────────────

const RETENTION_KEY = 'reki-desired-retention';

function loadRetention(): number {
  const raw = localStorage.getItem(RETENTION_KEY);
  if (!raw) return 0.9;
  const n = parseFloat(raw);
  return isNaN(n) ? 0.9 : Math.min(0.99, Math.max(0.7, n));
}

function createRetentionStore() {
  const { subscribe, set } = writable<number>(loadRetention());
  return {
    subscribe,
    set(value: number) {
      const clamped = Math.min(0.99, Math.max(0.7, value));
      localStorage.setItem(RETENTION_KEY, String(clamped));
      set(clamped);
    },
  };
}

export const desiredRetention = createRetentionStore();

// ─── FSRS bridge ────────────────────────────────────────────

export interface SchedulingChoice {
  interval: number;
  memory: { stability: number; difficulty: number };
}

export interface NextStates {
  again: SchedulingChoice;
  hard: SchedulingChoice;
  good: SchedulingChoice;
  easy: SchedulingChoice;
}

export async function fsrsNextStates(
  current: { stability: number; difficulty: number } | null,
  elapsedDays: number,
  retention: number,
): Promise<NextStates> {
  return invoke<NextStates>('fsrs_next_states', {
    current,
    elapsedDays,
    desiredRetention: retention,
  });
}
