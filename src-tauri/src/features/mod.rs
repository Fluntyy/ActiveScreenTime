pub mod goals;
pub mod break_reminder;
pub mod reports;
pub mod data_management;

use std::sync::Arc;
use crate::AppState;
use crate::tracker::TrackerEvent;

pub struct FeatureManager {
    pub goals: goals::GoalManager,
    pub breaks: break_reminder::BreakManager,
    pub reports: reports::ReportManager,
    /// Seconds of continuous tracked time since last break
    pub continuous_secs: i64,
}

impl FeatureManager {
    pub fn new() -> Self {
        Self {
            goals: goals::GoalManager::default(),
            breaks: break_reminder::BreakManager::default(),
            reports: reports::ReportManager::default(),
            continuous_secs: 0,
        }
    }

    /// Call every second from the UI update loop with the latest tracker event
    pub fn tick(&mut self, state: &Arc<AppState>, event: &TrackerEvent) -> Vec<FeatureAlert> {
        let mut alerts = Vec::new();

        let is_counting = matches!(event, TrackerEvent::Active { .. });

        if is_counting {
            self.continuous_secs += 1;
        } else {
            // Reset continuous counter only if not media-playing idle
            self.continuous_secs = 0;
        }

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let total_secs = state.db.lock().unwrap().get_today_usage(&today);

        // Check goal
        if let Some(alert) = self.goals.check(&state, total_secs, &today) {
            alerts.push(alert);
        }

        // Check break
        if let Some(alert) = self.breaks.check(&state, self.continuous_secs) {
            alerts.push(alert);
        }

        // Check reports
        alerts.extend(self.reports.check(&state, &today));

        alerts
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum FeatureAlert {
    GoalReached,
    BreakDue,
    WeeklyReport { total_secs: i64 },
    MonthlyReport { total_secs: i64 },
}
