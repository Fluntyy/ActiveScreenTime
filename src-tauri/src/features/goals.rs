use crate::{AppState, features::FeatureAlert};
use std::sync::Arc;

#[derive(Default)]
pub struct GoalManager {
    alerted_today: bool,
}

impl GoalManager {
    pub fn check(&mut self, state: &Arc<AppState>, total_secs: i64, today: &str) -> Option<FeatureAlert> {
        let db = state.db.lock().unwrap();

        let enabled = db.get_setting_or("goal_enabled", "0") == "1";
        if !enabled {
            return None;
        }

        let goal_mins: i64 = db.get_setting_or("goal_minutes", "240").parse().unwrap_or(240);
        let goal_secs = goal_mins * 60;
        let last_alert = db.get_setting_or("last_goal_alert_date", "");

        if total_secs >= goal_secs && last_alert != today && !self.alerted_today {
            self.alerted_today = true;
            drop(db);
            state.db.lock().unwrap().set_setting("last_goal_alert_date", today).ok();
            Some(FeatureAlert::GoalReached)
        } else {
            if last_alert != today {
                self.alerted_today = false;
            }
            None
        }
    }
}
