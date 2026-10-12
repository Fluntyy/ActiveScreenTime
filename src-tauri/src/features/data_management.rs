use crate::AppState;
use std::sync::Arc;

pub fn export_to_csv(state: &Arc<AppState>, out_dir: &std::path::Path) -> std::io::Result<()> {
    let db = state.db.lock().unwrap();
    
    // Daily
    let daily = db.get_daily_usage_rows();
    let mut daily_path = out_dir.to_path_buf();
    daily_path.push("daily_usage.csv");
    let mut d_writer = csv::Writer::from_path(daily_path)?;
    d_writer.write_record(&["Date", "Total Seconds", "Formatted"])?;
    for (d, s) in daily {
        let f = {
            let hours = s / 3600;
            let minutes = (s % 3600) / 60;
            if hours > 0 {
                format!("{}h {}m", hours, minutes)
            } else {
                format!("{}m", minutes)
            }
        };
        d_writer.write_record(&[&d, &s.to_string(), &f])?;
    }
    
    // Apps
    let apps = db.get_app_usage_rows();
    let mut app_path = out_dir.to_path_buf();
    app_path.push("app_usage.csv");
    let mut a_writer = csv::Writer::from_path(app_path)?;
    a_writer.write_record(&["Date", "Process Name", "Executable Path", "Seconds Used", "Formatted"])?;
    for (d, p, e, s) in apps {
        let f = {
            let hours = s / 3600;
            let minutes = (s % 3600) / 60;
            if hours > 0 {
                format!("{}h {}m", hours, minutes)
            } else {
                format!("{}m", minutes)
            }
        };
        a_writer.write_record(&[&d, &p, &e, &s.to_string(), &f])?;
    }
    
    Ok(())
}
