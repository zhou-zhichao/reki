use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

mod db;
mod media;
mod srs;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GeneratedCard {
    pub front: String,
    pub back: String,
}

#[tauri::command]
async fn generate_cards(
    app: tauri::AppHandle,
    topic: String,
    count: Option<u32>,
    cloze: Option<bool>,
) -> Result<Vec<GeneratedCard>, String> {
    let n = count.unwrap_or(5);
    let is_cloze = cloze.unwrap_or(false);
    let prompt = if is_cloze {
        format!(
            "Generate exactly {n} high-quality cloze deletion flashcards about the following topic.\n\n\
            Topic: {topic}\n\n\
            Rules:\n\
            - Use cloze deletion format: {{{{c1::answer}}}} or {{{{c1::answer::hint}}}}.\n\
            - Use multiple cloze numbers (c1, c2, c3...) for multiple deletions in one sentence.\n\
            - Put the cloze text in 'front'. Use 'back' for optional extra context.\n\
            - Output ONLY valid JSON: an array of objects with 'front' and 'back' string fields.\n\
            - No markdown code fences. No prose. No explanation. Just raw JSON.\n\
            - Do not include any text before or after the JSON array."
        )
    } else {
        format!(
            "Generate exactly {n} high-quality flashcards for spaced repetition about the following topic.\n\n\
            Topic: {topic}\n\n\
            Rules:\n\
            - Each card has a concise 'front' (question/prompt) and a clear 'back' (answer/explanation).\n\
            - Front should be atomic — test one concept per card.\n\
            - Back should be accurate and self-contained.\n\
            - Output ONLY valid JSON: an array of objects with 'front' and 'back' string fields.\n\
            - No markdown code fences. No prose. No explanation. Just raw JSON.\n\
            - Do not include any text before or after the JSON array."
        )
    };

    let shell = app.shell();
    let output = shell
        .command("claude")
        .args(["-p", &prompt])
        .output()
        .await
        .map_err(|e| format!("Failed to run claude CLI: {e}. Make sure 'claude' is in your PATH."))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("claude exited with error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Claude Code may append a `[result-id: ...]` line. Extract the JSON array only.
    let trimmed = stdout.trim();
    let json_str = extract_json_array(trimmed)
        .ok_or_else(|| format!("Could not find JSON array in claude output:\n{trimmed}"))?;

    serde_json::from_str::<Vec<GeneratedCard>>(&json_str)
        .map_err(|e| format!("Failed to parse JSON: {e}\nRaw: {json_str}"))
}

/// Extract the first top-level JSON array from a string.
fn extract_json_array(s: &str) -> Option<String> {
    let start = s.find('[')?;
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (i, &b) in bytes[start..].iter().enumerate() {
        if escape {
            escape = false;
            continue;
        }
        if in_str {
            if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..start + i + 1].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_json_array_with_trailing_marker() {
        let input = r#"[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]
[result-id: r5]"#;
        let result = extract_json_array(input).unwrap();
        let parsed: Vec<GeneratedCard> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].front, "Q1");
        assert_eq!(parsed[1].back, "A2");
    }

    #[test]
    fn handles_brackets_inside_strings() {
        let input = r#"[{"front":"What is [1, 2, 3]?","back":"A list"}]"#;
        let result = extract_json_array(input).unwrap();
        let parsed: Vec<GeneratedCard> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed[0].front, "What is [1, 2, 3]?");
    }

    #[test]
    fn handles_escaped_quotes_in_strings() {
        let input = r#"[{"front":"She said \"hi\"","back":"greeting"}]"#;
        let result = extract_json_array(input).unwrap();
        let parsed: Vec<GeneratedCard> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed[0].front, r#"She said "hi""#);
    }

    #[test]
    fn returns_none_when_no_array() {
        assert!(extract_json_array("just some text").is_none());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            generate_cards,
            srs::fsrs_next_states,
            db::db_load_all,
            db::db_save_deck,
            db::db_delete_deck,
            db::db_save_note,
            db::db_delete_note,
            db::db_save_card,
            db::db_delete_card,
            db::db_save_cards_bulk,
            media::media_save_blob,
            media::media_clean_unused,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Open the SQLite database and store the connection in app state.
            let path = db::db_path(app.handle());
            let conn = db::open(&path)
                .map_err(|e| format!("Failed to open database at {path:?}: {e}"))?;
            app.manage(std::sync::Mutex::new(conn));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
