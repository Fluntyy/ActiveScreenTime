use crate::{AppState, features::FeatureAlert};
use std::sync::Arc;
use chrono::{Datelike, Local, NaiveDate};

#[derive(Default)]
pub struct ReportManager;

impl ReportManager {
    pub fn check(&mut self, state: &Arc<AppState>, today: &str) -> Vec<FeatureAlert> {
        let mut alerts = Vec::new();
        let db = state.db.lock().unwrap();
        let now = Local::now();

        // Weekly (Sunday)
        if now.weekday() == chrono::Weekday::Sun {
            let last_alert = db.get_setting_or("last_weekly_report_date", "");
            if last_alert != today {
                let d = NaiveDate::parse_from_str(today, "%Y-%m-%d").unwrap_or_default();
                let start = (d - chrono::Duration::days(6)).format("%Y-%m-%d").to_string();
                let total = db.get_total_usage_for_range(&start, today);
                if total > 0 {
                    drop(db);
                    state.db.lock().unwrap().set_setting("last_weekly_report_date", today).ok();
                    alerts.push(FeatureAlert::WeeklyReport { total_secs: total });
                    return alerts; // Return early, db is dropped
                }
            }
        }

        // Monthly (Last day of month)
        let tomorrow = now + chrono::Duration::days(1);
        if tomorrow.month() != now.month() {
            if db.get_setting_or("monthly_notification", "0") == "1" {
                let current_month = now.format("%Y-%m").to_string();
                let last_alert = db.get_setting_or("last_monthly_report_date", "");
                if last_alert != current_month {
                    let start = format!("{}-01", current_month);
                    let total = db.get_total_usage_for_range(&start, today);
                    if total > 0 {
                        drop(db);
                        state.db.lock().unwrap().set_setting("last_monthly_report_date", &current_month).ok();
                        alerts.push(FeatureAlert::MonthlyReport { total_secs: total });
                    }
                }
            }
        }

        alerts
    }
}
