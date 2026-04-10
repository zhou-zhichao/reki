//! SQLite persistence for Reki.
//!
//! Single-file database stored under the OS app-data directory:
//!   Linux:   ~/.local/share/at.outlook.zhichao.reki/reki.db
//!   macOS:   ~/Library/Application Support/at.outlook.zhichao.reki/reki.db
//!   Windows: %APPDATA%\at.outlook.zhichao.reki\reki.db
//!
//! Schema is versioned via the `schema_meta` table; migrations run on startup.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub type DbState = Mutex<Connection>;

// ────────────────────────────────────────
// Models
// ────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub deck_id: String,
    pub note_id: String,
    pub ordinal: i64,
    pub front: String,
    pub back: String,

    pub stability: Option<f32>,
    pub difficulty: Option<f32>,
    pub last_review: Option<i64>,

    pub interval: i64,
    pub due: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub ease: f32,

    pub tags: Vec<String>,
    pub created_at: i64,
    pub edited_at: i64,
    pub flag: i64,
    pub position: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub deck_id: String,
    pub note_type: String,
    pub front: String,
    pub back: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub edited_at: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub decks: Vec<Deck>,
    pub notes: Vec<Note>,
    pub cards: Vec<Card>,
}

// ────────────────────────────────────────
// Initialization & migrations
// ────────────────────────────────────────

pub fn db_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should be resolvable");
    std::fs::create_dir_all(&dir).expect("create app data dir");
    dir.join("reki.db")
}

pub fn open(path: &PathBuf) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    migrate(&conn)?;
    Ok(conn)
}

fn current_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        [],
    )?;
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key = 'version'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.and_then(|s| s.parse().ok()).unwrap_or(0))
}

fn set_version(conn: &Connection, version: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![version.to_string()],
    )?;
    Ok(())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let v = current_version(conn)?;

    if v < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS decks (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cards (
                id           TEXT PRIMARY KEY,
                deck_id      TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
                front        TEXT NOT NULL,
                back         TEXT NOT NULL,

                stability    REAL,
                difficulty   REAL,
                last_review  INTEGER,

                interval     INTEGER NOT NULL DEFAULT 0,
                due          INTEGER NOT NULL,
                reps         INTEGER NOT NULL DEFAULT 0,
                lapses       INTEGER NOT NULL DEFAULT 0,
                state        TEXT NOT NULL DEFAULT 'new',
                ease         REAL NOT NULL DEFAULT 2.5,

                tags         TEXT NOT NULL DEFAULT '[]',
                created_at   INTEGER NOT NULL,
                edited_at    INTEGER NOT NULL,
                flag         INTEGER NOT NULL DEFAULT 0,
                position     INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS cards_deck_id ON cards(deck_id);
            CREATE INDEX IF NOT EXISTS cards_due ON cards(due);
            CREATE INDEX IF NOT EXISTS cards_state ON cards(state);
            "#,
        )?;
        set_version(conn, 1)?;
    }

    if v < 2 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS notes (
                id          TEXT PRIMARY KEY,
                deck_id     TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
                note_type   TEXT NOT NULL DEFAULT 'basic',
                front       TEXT NOT NULL DEFAULT '',
                back        TEXT NOT NULL DEFAULT '',
                tags        TEXT NOT NULL DEFAULT '[]',
                created_at  INTEGER NOT NULL,
                edited_at   INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS notes_deck_id ON notes(deck_id);

            ALTER TABLE cards ADD COLUMN note_id TEXT REFERENCES notes(id) ON DELETE CASCADE DEFAULT '';
            ALTER TABLE cards ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0;
            "#,
        )?;

        // Migrate existing cards: create a basic note for each card
        let mut stmt = conn.prepare(
            "SELECT id, deck_id, front, back, tags, created_at, edited_at FROM cards WHERE note_id = ''"
        )?;
        let rows: Vec<(String, String, String, String, String, i64, i64)> = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (card_id, deck_id, front, back, tags, created_at, edited_at) in &rows {
            let note_id = format!("n_{card_id}");
            conn.execute(
                "INSERT INTO notes (id, deck_id, note_type, front, back, tags, created_at, edited_at)
                 VALUES (?1, ?2, 'basic', ?3, ?4, ?5, ?6, ?7)",
                params![note_id, deck_id, front, back, tags, created_at, edited_at],
            )?;
            conn.execute(
                "UPDATE cards SET note_id = ?1, ordinal = 0 WHERE id = ?2",
                params![note_id, card_id],
            )?;
        }

        set_version(conn, 2)?;
    }

    Ok(())
}

// ────────────────────────────────────────
// Row mapping
// ────────────────────────────────────────

fn row_to_deck(r: &rusqlite::Row) -> rusqlite::Result<Deck> {
    Ok(Deck {
        id: r.get("id")?,
        name: r.get("name")?,
        created_at: r.get("created_at")?,
    })
}

fn row_to_note(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let tags_json: String = r.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Note {
        id: r.get("id")?,
        deck_id: r.get("deck_id")?,
        note_type: r.get("note_type")?,
        front: r.get("front")?,
        back: r.get("back")?,
        tags,
        created_at: r.get("created_at")?,
        edited_at: r.get("edited_at")?,
    })
}

fn row_to_card(r: &rusqlite::Row) -> rusqlite::Result<Card> {
    let tags_json: String = r.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Card {
        id: r.get("id")?,
        deck_id: r.get("deck_id")?,
        note_id: r.get("note_id")?,
        ordinal: r.get("ordinal")?,
        front: r.get("front")?,
        back: r.get("back")?,
        stability: r.get("stability")?,
        difficulty: r.get("difficulty")?,
        last_review: r.get("last_review")?,
        interval: r.get("interval")?,
        due: r.get("due")?,
        reps: r.get("reps")?,
        lapses: r.get("lapses")?,
        state: r.get("state")?,
        ease: r.get("ease")?,
        tags,
        created_at: r.get("created_at")?,
        edited_at: r.get("edited_at")?,
        flag: r.get("flag")?,
        position: r.get("position")?,
    })
}

// ────────────────────────────────────────
// Queries
// ────────────────────────────────────────

pub fn list_all_decks(conn: &Connection) -> rusqlite::Result<Vec<Deck>> {
    let mut stmt = conn.prepare("SELECT * FROM decks ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_deck)?;
    rows.collect()
}

pub fn list_all_notes(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare("SELECT * FROM notes ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_note)?;
    rows.collect()
}

pub fn list_all_cards(conn: &Connection) -> rusqlite::Result<Vec<Card>> {
    let mut stmt = conn.prepare("SELECT * FROM cards ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_card)?;
    rows.collect()
}

pub fn upsert_deck(conn: &Connection, d: &Deck) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO decks (id, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![d.id, d.name, d.created_at],
    )?;
    Ok(())
}

pub fn delete_deck_row(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn upsert_note(conn: &Connection, n: &Note) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&n.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO notes (id, deck_id, note_type, front, back, tags, created_at, edited_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            deck_id = excluded.deck_id,
            note_type = excluded.note_type,
            front = excluded.front,
            back = excluded.back,
            tags = excluded.tags,
            edited_at = excluded.edited_at",
        params![n.id, n.deck_id, n.note_type, n.front, n.back, tags_json, n.created_at, n.edited_at],
    )?;
    Ok(())
}

pub fn delete_note_row(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn upsert_card(conn: &Connection, c: &Card) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&c.tags).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO cards (
            id, deck_id, note_id, ordinal, front, back,
            stability, difficulty, last_review,
            interval, due, reps, lapses, state, ease,
            tags, created_at, edited_at, flag, position
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
        ON CONFLICT(id) DO UPDATE SET
            deck_id = excluded.deck_id,
            note_id = excluded.note_id,
            ordinal = excluded.ordinal,
            front = excluded.front,
            back = excluded.back,
            stability = excluded.stability,
            difficulty = excluded.difficulty,
            last_review = excluded.last_review,
            interval = excluded.interval,
            due = excluded.due,
            reps = excluded.reps,
            lapses = excluded.lapses,
            state = excluded.state,
            ease = excluded.ease,
            tags = excluded.tags,
            edited_at = excluded.edited_at,
            flag = excluded.flag,
            position = excluded.position",
        params![
            c.id, c.deck_id, c.note_id, c.ordinal, c.front, c.back,
            c.stability, c.difficulty, c.last_review,
            c.interval, c.due, c.reps, c.lapses, c.state, c.ease,
            tags_json, c.created_at, c.edited_at, c.flag, c.position,
        ],
    )?;
    Ok(())
}

pub fn delete_card_row(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM cards WHERE id = ?1", params![id])?;
    Ok(())
}

#[allow(dead_code)]
pub fn count_decks(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM decks", [], |r| r.get(0))
}

// ────────────────────────────────────────
// Tauri commands
// ────────────────────────────────────────

fn lock_err<T>(e: std::sync::PoisonError<T>) -> String {
    format!("DB lock poisoned: {e}")
}
fn db_err(e: rusqlite::Error) -> String {
    format!("DB error: {e}")
}

#[tauri::command]
pub fn db_load_all(state: State<'_, DbState>) -> Result<Snapshot, String> {
    let conn = state.lock().map_err(lock_err)?;
    let decks = list_all_decks(&conn).map_err(db_err)?;
    let notes = list_all_notes(&conn).map_err(db_err)?;
    let cards = list_all_cards(&conn).map_err(db_err)?;
    Ok(Snapshot { decks, notes, cards })
}

#[tauri::command]
pub fn db_save_deck(state: State<'_, DbState>, deck: Deck) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    upsert_deck(&conn, &deck).map_err(db_err)
}

#[tauri::command]
pub fn db_delete_deck(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    delete_deck_row(&conn, &id).map_err(db_err)
}

#[tauri::command]
pub fn db_save_note(state: State<'_, DbState>, note: Note) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    upsert_note(&conn, &note).map_err(db_err)
}

#[tauri::command]
pub fn db_delete_note(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    delete_note_row(&conn, &id).map_err(db_err)
}

#[tauri::command]
pub fn db_save_card(state: State<'_, DbState>, card: Card) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    upsert_card(&conn, &card).map_err(db_err)
}

#[tauri::command]
pub fn db_delete_card(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = state.lock().map_err(lock_err)?;
    delete_card_row(&conn, &id).map_err(db_err)
}

#[tauri::command]
pub fn db_save_cards_bulk(state: State<'_, DbState>, cards: Vec<Card>) -> Result<(), String> {
    let mut conn = state.lock().map_err(lock_err)?;
    let tx = conn.transaction().map_err(db_err)?;
    for c in &cards {
        upsert_card(&tx, c).map_err(db_err)?;
    }
    tx.commit().map_err(db_err)
}

// ────────────────────────────────────────
// Tests
// ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrations_create_tables() {
        let conn = test_conn();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('decks','cards')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn migration_v2_creates_notes_table() {
        let conn = test_conn();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='notes'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_and_list_decks() {
        let conn = test_conn();
        upsert_deck(
            &conn,
            &Deck { id: "d1".into(), name: "Japanese".into(), created_at: 1000 },
        )
        .unwrap();
        upsert_deck(
            &conn,
            &Deck { id: "d1".into(), name: "Japanese N2".into(), created_at: 1000 },
        )
        .unwrap();
        let decks = list_all_decks(&conn).unwrap();
        assert_eq!(decks.len(), 1);
        assert_eq!(decks[0].name, "Japanese N2");
    }

    #[test]
    fn upsert_and_list_notes() {
        let conn = test_conn();
        upsert_deck(&conn, &Deck { id: "d1".into(), name: "Test".into(), created_at: 0 }).unwrap();
        let note = Note {
            id: "n1".into(),
            deck_id: "d1".into(),
            note_type: "cloze".into(),
            front: "{{c1::Paris}}".into(),
            back: "".into(),
            tags: vec!["geo".into()],
            created_at: 100,
            edited_at: 100,
        };
        upsert_note(&conn, &note).unwrap();
        let notes = list_all_notes(&conn).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].note_type, "cloze");
    }

    #[test]
    fn upsert_and_list_cards() {
        let conn = test_conn();
        upsert_deck(
            &conn,
            &Deck { id: "d1".into(), name: "Test".into(), created_at: 0 },
        )
        .unwrap();
        let note = Note {
            id: "n1".into(),
            deck_id: "d1".into(),
            note_type: "basic".into(),
            front: "front".into(),
            back: "back".into(),
            tags: vec![],
            created_at: 0,
            edited_at: 0,
        };
        upsert_note(&conn, &note).unwrap();
        let card = Card {
            id: "c1".into(),
            deck_id: "d1".into(),
            note_id: "n1".into(),
            ordinal: 0,
            front: "front".into(),
            back: "back".into(),
            stability: Some(3.5),
            difficulty: Some(5.0),
            last_review: Some(123),
            interval: 4,
            due: 456,
            reps: 1,
            lapses: 0,
            state: "review".into(),
            ease: 2.5,
            tags: vec!["a".into(), "b".into()],
            created_at: 100,
            edited_at: 100,
            flag: 2,
            position: 0,
        };
        upsert_card(&conn, &card).unwrap();
        let cards = list_all_cards(&conn).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].tags, vec!["a", "b"]);
        assert_eq!(cards[0].stability, Some(3.5));
    }

    #[test]
    fn deleting_deck_cascades_to_cards() {
        let conn = test_conn();
        upsert_deck(
            &conn,
            &Deck { id: "d1".into(), name: "X".into(), created_at: 0 },
        )
        .unwrap();
        let note = Note {
            id: "n1".into(),
            deck_id: "d1".into(),
            note_type: "basic".into(),
            front: "f".into(),
            back: "b".into(),
            tags: vec![],
            created_at: 0,
            edited_at: 0,
        };
        upsert_note(&conn, &note).unwrap();
        let card = Card {
            id: "c1".into(),
            deck_id: "d1".into(),
            note_id: "n1".into(),
            ordinal: 0,
            front: "f".into(),
            back: "b".into(),
            stability: None,
            difficulty: None,
            last_review: None,
            interval: 0,
            due: 0,
            reps: 0,
            lapses: 0,
            state: "new".into(),
            ease: 2.5,
            tags: vec![],
            created_at: 0,
            edited_at: 0,
            flag: 0,
            position: 0,
        };
        upsert_card(&conn, &card).unwrap();
        delete_deck_row(&conn, "d1").unwrap();
        assert_eq!(list_all_cards(&conn).unwrap().len(), 0);
    }

    #[test]
    fn deleting_note_cascades_to_cards() {
        let conn = test_conn();
        upsert_deck(&conn, &Deck { id: "d1".into(), name: "X".into(), created_at: 0 }).unwrap();
        let note = Note {
            id: "n1".into(), deck_id: "d1".into(), note_type: "basic".into(),
            front: "f".into(), back: "b".into(), tags: vec![], created_at: 0, edited_at: 0,
        };
        upsert_note(&conn, &note).unwrap();
        let card = Card {
            id: "c1".into(), deck_id: "d1".into(), note_id: "n1".into(), ordinal: 0,
            front: "f".into(), back: "b".into(),
            stability: None, difficulty: None, last_review: None,
            interval: 0, due: 0, reps: 0, lapses: 0, state: "new".into(), ease: 2.5,
            tags: vec![], created_at: 0, edited_at: 0, flag: 0, position: 0,
        };
        upsert_card(&conn, &card).unwrap();
        delete_note_row(&conn, "n1").unwrap();
        assert_eq!(list_all_cards(&conn).unwrap().len(), 0);
    }
}
