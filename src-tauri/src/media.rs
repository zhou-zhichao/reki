//! Content-addressed media (image) storage for Reki.
//!
//! Files are stored under `<app_data_dir>/media/` and named by the first 8 bytes
//! of their SHA-256 digest (hex-encoded, 16 chars), e.g. `b94d27b9934d3e08.png`.
//! Identical files are automatically deduplicated.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Maximum allowed blob size (10 MiB).
pub const MAX_BLOB_BYTES: usize = 10 * 1024 * 1024;

// ────────────────────────────────────────
// Public types
// ────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub deleted_count: u64,
    pub freed_bytes: u64,
}

// ────────────────────────────────────────
// Core helpers
// ────────────────────────────────────────

/// Returns the media directory for the app, creating it if it does not exist.
pub fn media_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should be resolvable");
    let dir = base.join("media");
    std::fs::create_dir_all(&dir).expect("create media dir");
    dir
}

/// Save raw bytes to `dir` using a content-addressed filename.
///
/// Returns the filename (not the full path) on success.
pub fn save_blob_to_dir(dir: &Path, bytes: &[u8], ext: &str) -> Result<String, String> {
    // 1. Size guard
    if bytes.len() > MAX_BLOB_BYTES {
        return Err(format!(
            "Blob too large: {} bytes (max {} bytes)",
            bytes.len(),
            MAX_BLOB_BYTES
        ));
    }

    // 2. Sanitize extension: ASCII alphanumerics only, max 8 chars
    let sanitized: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if sanitized.is_empty() {
        return Err(format!(
            "Empty extension after sanitization (original: {:?})",
            ext
        ));
    }

    // 3. SHA-256, first 8 bytes → 16 hex chars
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let hex: String = digest[..8]
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect();

    // 4. Build filename
    let filename = format!("{}.{}", hex, sanitized);
    let dest = dir.join(&filename);

    // 5. Dedup: if file already exists, return without rewriting
    if dest.exists() {
        return Ok(filename);
    }

    // 6. Write
    std::fs::write(&dest, bytes)
        .map_err(|e| format!("Failed to write media file {:?}: {}", dest, e))?;

    Ok(filename)
}

/// Parse markdown image references from a slice of text strings.
///
/// Handles:
/// - `![alt](filename)`
/// - `![alt with spaces](filename)`
/// - `![](filename)`
/// - `![ alt ]( filename )` (extra whitespace)
/// - `![alt](filename "title")` (takes only first whitespace-delimited token)
fn extract_referenced_filenames(texts: &[String]) -> HashSet<String> {
    let mut referenced = HashSet::new();
    for text in texts {
        // Find all `![...](...)`  occurrences
        let mut search_from = 0;
        while let Some(bang_pos) = text[search_from..].find("![") {
            let abs_bang = search_from + bang_pos;
            // Find the closing `]` of the alt text
            if let Some(close_bracket) = text[abs_bang..].find(']') {
                let after_bracket = abs_bang + close_bracket + 1;
                // Skip optional whitespace between `]` and `(`
                let rest = &text[after_bracket..];
                let trimmed_rest = rest.trim_start();
                if trimmed_rest.starts_with('(') {
                    let paren_start =
                        after_bracket + (rest.len() - trimmed_rest.len()) + 1;
                    // Find closing `)`
                    if let Some(rel_close) = text[paren_start..].find(')') {
                        let inner = &text[paren_start..paren_start + rel_close];
                        // Take only the first whitespace-delimited token
                        if let Some(token) = inner.split_whitespace().next() {
                            if !token.is_empty() {
                                referenced.insert(token.to_string());
                            }
                        }
                        search_from = paren_start + rel_close + 1;
                        continue;
                    }
                }
                search_from = after_bracket;
                continue;
            }
            search_from = abs_bang + 2;
        }
    }
    referenced
}

/// Delete files in `dir` that are not referenced in `texts`.
///
/// Returns counts of deleted files and freed bytes.
pub fn cleanup_unused_in_dir(dir: &Path, texts: &[String]) -> Result<CleanResult, String> {
    let referenced = extract_referenced_filenames(texts);

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read media dir {:?}: {}", dir, e))?;

    let mut deleted_count: u64 = 0;
    let mut freed_bytes: u64 = 0;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let meta = entry
            .metadata()
            .map_err(|e| format!("Metadata error: {}", e))?;

        if !meta.is_file() {
            continue;
        }

        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy().into_owned();

        if referenced.contains(&fname_str) {
            continue;
        }

        // Delete orphan
        freed_bytes += meta.len();
        std::fs::remove_file(entry.path())
            .map_err(|e| format!("Failed to delete {:?}: {}", entry.path(), e))?;
        deleted_count += 1;
    }

    Ok(CleanResult { deleted_count, freed_bytes })
}

// ────────────────────────────────────────
// Tauri commands
// ────────────────────────────────────────

#[tauri::command]
pub async fn media_save_blob(
    app: AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let dir = media_dir(&app);
    save_blob_to_dir(&dir, &bytes, &ext)
}

#[tauri::command]
pub async fn media_clean_unused(
    app: AppHandle,
    texts: Vec<String>,
) -> Result<CleanResult, String> {
    let dir = media_dir(&app);
    cleanup_unused_in_dir(&dir, &texts)
}

// ────────────────────────────────────────
// Tests
// ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        tempfile::tempdir().expect("create temp dir")
    }

    // ── save_blob helpers ──────────────────────────────────────────────────

    #[test]
    fn save_blob_writes_file_with_hash_filename() {
        let dir = tmp();
        let bytes = b"hello world";
        let filename = save_blob_to_dir(dir.path(), bytes, "txt").unwrap();
        // SHA-256("hello world") starts with b94d27b9934d3e08...
        assert!(
            filename.starts_with("b94d27b9934d3e08"),
            "filename should start with correct hash prefix, got: {}",
            filename
        );
        assert_eq!(filename, "b94d27b9934d3e08.txt");
        let contents = std::fs::read(dir.path().join(&filename)).unwrap();
        assert_eq!(contents, bytes);
    }

    #[test]
    fn save_blob_deduplicates_identical_bytes() {
        let dir = tmp();
        let bytes = b"dedup test content";
        let f1 = save_blob_to_dir(dir.path(), bytes, "png").unwrap();
        let f2 = save_blob_to_dir(dir.path(), bytes, "png").unwrap();
        assert_eq!(f1, f2, "filenames should match for identical content");
        // Only one file should exist
        let count = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(count, 1, "only one file should exist after dedup");
    }

    #[test]
    fn save_blob_rejects_oversized_input() {
        let dir = tmp();
        let big = vec![0u8; MAX_BLOB_BYTES + 1];
        let result = save_blob_to_dir(dir.path(), &big, "bin");
        assert!(result.is_err(), "expected Err for oversized blob");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("too large") || msg.contains("too Large"),
            "error should mention 'too large', got: {}",
            msg
        );
    }

    #[test]
    fn save_blob_rejects_empty_extension() {
        let dir = tmp();
        let result = save_blob_to_dir(dir.path(), b"data", "");
        assert!(result.is_err(), "expected Err for empty extension");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("Empty") || msg.contains("empty"),
            "error should mention 'Empty', got: {}",
            msg
        );
    }

    #[test]
    fn save_blob_sanitizes_extension() {
        let dir = tmp();
        // `../etc` → after filtering non-alphanumeric: `etc`
        let filename = save_blob_to_dir(dir.path(), b"sanitize me", "../etc").unwrap();
        assert!(
            filename.ends_with(".etc"),
            "filename should end in '.etc', got: {}",
            filename
        );
    }

    // ── cleanup helpers ────────────────────────────────────────────────────

    #[test]
    fn cleanup_removes_orphans_keeps_referenced() {
        let dir = tmp();
        let f1 = save_blob_to_dir(dir.path(), b"content one", "jpg").unwrap();
        let _f2 = save_blob_to_dir(dir.path(), b"content two", "jpg").unwrap();

        let texts = vec![format!("![alt]({})", f1)];
        let result = cleanup_unused_in_dir(dir.path(), &texts).unwrap();

        assert_eq!(result.deleted_count, 1, "one orphan should be deleted");
        assert!(result.freed_bytes > 0, "freed_bytes should be > 0");

        // The referenced file still exists
        assert!(dir.path().join(&f1).exists(), "kept file should still exist");
        // Only one file remains
        let count = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(count, 1, "only one file should remain");
    }

    #[test]
    fn cleanup_handles_multiple_images_per_text_and_quirks() {
        let dir = tmp();
        let a = save_blob_to_dir(dir.path(), b"blob a", "png").unwrap();
        let b = save_blob_to_dir(dir.path(), b"blob b", "png").unwrap();
        let c = save_blob_to_dir(dir.path(), b"blob c", "png").unwrap();
        let _orphan = save_blob_to_dir(dir.path(), b"blob orphan", "png").unwrap();

        let texts = vec![
            // extra parens around URL — parser should still find `a` via whitespace tokenizing
            format!("![](( {} ))", a),
            // alt with spaces
            format!("![alt with spaces]({})", b),
            // multiple per text, repeat a
            format!("![]({}) and ![]({})", c, a),
        ];

        let result = cleanup_unused_in_dir(dir.path(), &texts).unwrap();
        assert_eq!(result.deleted_count, 1, "only the orphan should be deleted");

        assert!(dir.path().join(&a).exists(), "a should still exist");
        assert!(dir.path().join(&b).exists(), "b should still exist");
        assert!(dir.path().join(&c).exists(), "c should still exist");
    }
}
