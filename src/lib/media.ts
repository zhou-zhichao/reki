/**
 * JS bridge for the Rust media module.
 *
 * - importBlob(blob)         save a Blob/File and return its filename
 * - toAssetUrl(filename)     async helper to convert a filename to a Tauri asset URL
 * - toAssetUrlSync(filename) sync version using a cached media dir (call initMediaPaths first)
 * - initMediaPaths()         resolve the media dir once at app startup
 * - cleanUnused(texts)       ask Rust to garbage-collect orphaned media
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CleanResult {
  deletedCount: number;
  freedBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache
// ─────────────────────────────────────────────────────────────────────────────

let cachedMediaDir: string | null = null;
let syncMediaDir: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function extensionFromBlob(blob: Blob): string {
  const type = blob.type || '';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/svg+xml') return 'svg';
  if (type === 'image/bmp') return 'bmp';
  // Try to extract from File.name if available
  if ('name' in blob && typeof (blob as File).name === 'string') {
    const m = (blob as File).name.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  }
  return 'bin';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a Blob/File to the media directory and return its generated filename.
 */
export async function importBlob(blob: Blob): Promise<string> {
  const ext = extensionFromBlob(blob);
  const buffer = await blob.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  return invoke<string>('media_save_blob', { bytes, ext });
}

/**
 * Convert a media filename to a Tauri asset URL (async, caches the media dir).
 */
export async function toAssetUrl(filename: string): Promise<string> {
  if (cachedMediaDir === null) {
    const base = await appDataDir();
    cachedMediaDir = await join(base, 'media');
  }
  const fullPath = await join(cachedMediaDir, filename);
  return convertFileSrc(fullPath, 'asset');
}

/**
 * Convert a media filename to a Tauri asset URL synchronously.
 * Returns the bare filename if initMediaPaths() has not been called yet.
 */
export function toAssetUrlSync(filename: string): string {
  if (syncMediaDir === null) {
    return filename;
  }
  return convertFileSrc(`${syncMediaDir}/${filename}`, 'asset');
}

/**
 * Resolve and cache the media directory path. Call once at app startup before
 * any toAssetUrlSync calls.
 */
export async function initMediaPaths(): Promise<void> {
  const base = await appDataDir();
  const mediaDir = await join(base, 'media');
  syncMediaDir = mediaDir;
  cachedMediaDir = mediaDir;
}

/**
 * Ask Rust to delete media files not referenced in any of the provided texts.
 */
export async function cleanUnused(texts: string[]): Promise<CleanResult> {
  return invoke<CleanResult>('media_clean_unused', { texts });
}
