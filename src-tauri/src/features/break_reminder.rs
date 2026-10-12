#![allow(dead_code)]

use crate::{AppState, features::FeatureAlert};
use std::sync::Arc;

#[derive(Default)]
pub struct BreakManager {
    snoozed_until_secs: i64,
}

impl BreakManager {
    pub fn check(&mut self, state: &Arc<AppState>, continuous_secs: i64) -> Option<FeatureAlert> {
        let db = state.db.lock().unwrap();
        
        if db.get_setting_or("break_enabled", "0") != "1" {
            return None;
        }

        let interval_mins: i64 = db.get_setting_or("break_interval", "60").parse().unwrap_or(60);
        let interval_secs = interval_mins * 60;

        // If we exceeded the interval AND we aren't currently snoozed
        if continuous_secs > 0 && continuous_secs >= interval_secs && continuous_secs >= self.snoozed_until_secs {
            // Automatically snooze it slightly to prevent spamming while the UI dialog is active
            let snooze_mins: i64 = db.get_setting_or("break_snooze", "10").parse().unwrap_or(10);
            self.snoozed_until_secs = continuous_secs + (snooze_mins * 60);
            return Some(FeatureAlert::BreakDue);
        }

        None
    }

    pub fn snooze(&mut self, state: &Arc<AppState>, current_continuous: i64) {
        let db = state.db.lock().unwrap();
        let snooze_mins: i64 = db.get_setting_or("break_snooze", "10").parse().unwrap_or(10);
        self.snoozed_until_secs = current_continuous + (snooze_mins * 60);
    }
    
    pub fn reset(&mut self) {
        self.snoozed_until_secs = 0;
    }
}
