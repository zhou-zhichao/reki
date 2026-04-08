//! FSRS scheduling wrapper.
//!
//! Wraps the `fsrs` crate behind a small set of Tauri commands so the
//! frontend can:
//!   1. Compute scheduling previews (intervals for each rating)
//!   2. Apply a rating to a card and receive its updated memory state
//!
//! All scheduling logic lives in Rust. The frontend remains stateless
//! about FSRS internals — it just stores `stability`, `difficulty`,
//! `last_review`, and `interval` fields it received from us.

use fsrs::{DEFAULT_PARAMETERS, FSRS, MemoryState};
use serde::{Deserialize, Serialize};

/// Memory state stored on a card. Mirrors `fsrs::MemoryState` but is
/// JSON-serializable for the JS bridge. `None` for never-reviewed cards.
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct SerializedMemoryState {
    pub stability: f32,
    pub difficulty: f32,
}

impl From<MemoryState> for SerializedMemoryState {
    fn from(m: MemoryState) -> Self {
        Self { stability: m.stability, difficulty: m.difficulty }
    }
}

impl From<SerializedMemoryState> for MemoryState {
    fn from(m: SerializedMemoryState) -> Self {
        Self { stability: m.stability, difficulty: m.difficulty }
    }
}

/// One scheduling option (one of Again / Hard / Good / Easy).
#[derive(Serialize, Debug, Clone, Copy)]
pub struct SchedulingChoice {
    /// Days until next review (rounded to integer, min 1).
    pub interval: u32,
    /// Updated memory state if the user picks this rating.
    pub memory: SerializedMemoryState,
}

/// All four scheduling options for a card given its current state.
#[derive(Serialize, Debug, Clone, Copy)]
pub struct NextStates {
    pub again: SchedulingChoice,
    pub hard: SchedulingChoice,
    pub good: SchedulingChoice,
    pub easy: SchedulingChoice,
}

fn build_choice(opt: &fsrs::ItemState) -> SchedulingChoice {
    let interval = opt.interval.round().max(1.0) as u32;
    SchedulingChoice {
        interval,
        memory: opt.memory.into(),
    }
}

/// Compute the four next-state options for a card.
///
/// `current` is the card's current memory state, or `None` for new cards.
/// `elapsed_days` is the number of days since the last review (0 for new).
/// `desired_retention` typically 0.85 – 0.97; the FSRS sweet spot is 0.9.
#[tauri::command]
pub fn fsrs_next_states(
    current: Option<SerializedMemoryState>,
    elapsed_days: u32,
    desired_retention: f32,
) -> Result<NextStates, String> {
    let fsrs = FSRS::new(Some(&DEFAULT_PARAMETERS))
        .map_err(|e| format!("FSRS init failed: {e}"))?;
    let memory = current.map(MemoryState::from);

    let next = fsrs
        .next_states(memory, desired_retention, elapsed_days)
        .map_err(|e| format!("FSRS error: {e}"))?;

    Ok(NextStates {
        again: build_choice(&next.again),
        hard: build_choice(&next.hard),
        good: build_choice(&next.good),
        easy: build_choice(&next.easy),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedules_a_brand_new_card() {
        let states = fsrs_next_states(None, 0, 0.9).unwrap();

        // For a new card, all four options should produce a positive interval.
        assert!(states.again.interval >= 1);
        assert!(states.hard.interval >= 1);
        assert!(states.good.interval >= 1);
        assert!(states.easy.interval >= 1);

        // Easy should not be shorter than Good for a new card.
        assert!(states.easy.interval >= states.good.interval);
    }

    #[test]
    fn schedules_an_existing_card() {
        let memory = SerializedMemoryState { stability: 7.0, difficulty: 5.0 };
        let states = fsrs_next_states(Some(memory), 7, 0.9).unwrap();

        // Easy interval should be > Good > Hard for a mature card.
        assert!(states.easy.interval >= states.good.interval);
        assert!(states.good.interval >= states.hard.interval);
    }

    #[test]
    fn again_resets_stability() {
        let memory = SerializedMemoryState { stability: 30.0, difficulty: 5.0 };
        let states = fsrs_next_states(Some(memory), 30, 0.9).unwrap();

        // Pressing Again on a stable card should drop stability sharply.
        assert!(states.again.memory.stability < memory.stability);
    }
}
