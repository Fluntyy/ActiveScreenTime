use rusqlite::{Connection, Result, params};
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
    pub db_path: String,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        let db = Database { conn: Mutex::new(conn), db_path: path.to_string() };
        db.init()?;
        db.normalize_process_names();
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS Settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS DailyUsage (
                date TEXT PRIMARY KEY,
                total_seconds INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS ApplicationUsage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                process_name TEXT,
                exe_path TEXT,
                seconds_used INTEGER DEFAULT 0,
                UNIQUE(date, exe_path)
            );
            INSERT OR IGNORE INTO Settings VALUES ('idle_timeout', '300');
            INSERT OR IGNORE INTO Settings VALUES ('theme', 'System');
            INSERT OR IGNORE INTO Settings VALUES ('theme_mode', 'System');
            INSERT OR IGNORE INTO Settings VALUES ('start_with_windows', '0');
            INSERT OR IGNORE INTO Settings VALUES ('minimize_tray', '1');
            INSERT OR IGNORE INTO Settings VALUES ('always_on_top', '0');
            INSERT OR IGNORE INTO Settings VALUES ('track_fullscreen', '1');
            INSERT OR IGNORE INTO Settings VALUES ('count_fullscreen', '1');
            INSERT OR IGNORE INTO Settings VALUES ('track_media', '0');
            INSERT OR IGNORE INTO Settings VALUES ('hide_active_app', '0');
            INSERT OR IGNORE INTO Settings VALUES ('hide_active_status', '0');
            INSERT OR IGNORE INTO Settings VALUES ('date_format', '%a');
            INSERT OR IGNORE INTO Settings VALUES ('goal_enabled', '0');
            INSERT OR IGNORE INTO Settings VALUES ('goal_minutes', '480');
            INSERT OR IGNORE INTO Settings VALUES ('break_enabled', '0');
            INSERT OR IGNORE INTO Settings VALUES ('break_interval', '60');
            INSERT OR IGNORE INTO Settings VALUES ('break_snooze', '10');
            INSERT OR IGNORE INTO Settings VALUES ('last_goal_alert_date', '');
            INSERT OR IGNORE INTO Settings VALUES ('last_weekly_report_date', '');
            INSERT OR IGNORE INTO Settings VALUES ('last_monthly_report_date', '');
            INSERT OR IGNORE INTO Settings VALUES ('monthly_notification', '1');
            INSERT OR IGNORE INTO Settings VALUES ('first_run_completed', '0');
            INSERT OR IGNORE INTO Settings VALUES ('rename_rules', '[]');
            INSERT OR IGNORE INTO Settings VALUES ('ignore_lockapp', '1');
            INSERT OR IGNORE INTO Settings VALUES ('ignore_searchhost', '1');
            INSERT OR IGNORE INTO Settings VALUES ('ignore_shellhost', '1');
            INSERT OR IGNORE INTO Settings VALUES ('ignore_shellexperiencehost', '1');
            INSERT OR IGNORE INTO Settings VALUES ('disable_windows_apps', '0');
            INSERT OR IGNORE INTO Settings VALUES ('ignore_system_ui', '1');
        ")?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        let conn = self.conn.lock().unwrap();
        if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM Settings") {
            if let Ok(mut rows) = stmt.query([]) {
                while let Ok(Some(row)) = rows.next() {
                    if let (Ok(k), Ok(v)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                        map.insert(k, v);
                    }
                }
            }
        }
        map
    }

    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM Settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ).ok()
    }

    pub fn get_setting_or(&self, key: &str, default: &str) -> String {
        self.get_setting(key).unwrap_or_else(|| default.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO Settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn log_usage(&self, date: &str, process_name: &str, exe_path: &str, seconds: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO DailyUsage (date, total_seconds) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET total_seconds = total_seconds + ?2",
            params![date, seconds],
        )?;
        if !exe_path.is_empty() {
            conn.execute(
                "INSERT INTO ApplicationUsage (date, process_name, exe_path, seconds_used)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(date, exe_path) DO UPDATE SET
                     seconds_used = seconds_used + ?4,
                     process_name = ?2",
                params![date, process_name, exe_path, seconds],
            )?;
        }
        Ok(())
    }

    pub fn get_today_usage(&self, date: &str) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT total_seconds FROM DailyUsage WHERE date = ?1",
            params![date],
            |row| row.get(0),
        ).unwrap_or(0)
    }

    pub fn normalize_process_names(&self) {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT DISTINCT exe_path, process_name FROM ApplicationUsage WHERE exe_path != ''") {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows: Vec<(String, String)> = match stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))) {
            Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
            Err(_) => return,
        };
        drop(stmt);

        for (exe, proc) in rows {
            let friendly = crate::tracker::windows::get_friendly_name(&exe, &proc);
            if friendly != proc {
                let _ = conn.execute(
                    "UPDATE ApplicationUsage SET process_name = ?1 WHERE exe_path = ?2",
                    params![friendly, exe],
                );
            }
        }
    }

    pub fn get_today_app_usage(&self, date: &str) -> Vec<(String, String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT process_name, exe_path, seconds_used FROM ApplicationUsage
             WHERE date = ?1 ORDER BY seconds_used DESC"
        ).unwrap();
        stmt.query_map(params![date], |row| {
            let proc: String = row.get(0)?;
            let exe: String = row.get(1)?;
            let secs: i64 = row.get(2)?;
            let friendly = if !exe.is_empty() {
                crate::tracker::windows::get_friendly_name(&exe, &proc)
            } else {
                proc
            };
            Ok((friendly, exe, secs))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_history_for_range(&self, start: &str, end: &str) -> Vec<(String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date, total_seconds FROM DailyUsage WHERE date >= ?1 AND date <= ?2 ORDER BY date ASC"
        ).unwrap();
        stmt.query_map(params![start, end], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_app_history_for_range(&self, process_name: &str, start: &str, end: &str) -> Vec<(String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date, SUM(seconds_used) FROM ApplicationUsage
             WHERE (process_name = ?1 OR process_name = ?4) AND date >= ?2 AND date <= ?3 GROUP BY date ORDER BY date ASC"
        ).unwrap();
        let stripped = process_name.strip_suffix(".exe").unwrap_or(process_name);
        stmt.query_map(params![process_name, start, end, stripped], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    /// Returns (first_day, max_seconds, avg_seconds)
    pub fn get_statistics(&self) -> (Option<String>, i64, f64) {
        let conn = self.conn.lock().unwrap();
        let first_day: Option<String> = conn.query_row(
            "SELECT MIN(date) FROM DailyUsage", [], |r| r.get(0)
        ).unwrap_or(None);
        let max_sec: i64 = conn.query_row(
            "SELECT COALESCE(MAX(total_seconds), 0) FROM DailyUsage", [], |r| r.get(0)
        ).unwrap_or(0);
        let avg_sec: f64 = conn.query_row(
            "SELECT COALESCE(AVG(total_seconds), 0) FROM DailyUsage", [], |r| r.get(0)
        ).unwrap_or(0.0);
        (first_day, max_sec, avg_sec)
    }

    pub fn get_total_tracked_days(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(DISTINCT date) FROM DailyUsage", [], |r| r.get(0)
        ).unwrap_or(0)
    }

    pub fn get_total_usage_for_range(&self, start: &str, end: &str) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(SUM(total_seconds), 0) FROM DailyUsage WHERE date >= ?1 AND date <= ?2",
            params![start, end], |r| r.get(0)
        ).unwrap_or(0)
    }

    pub fn get_top_apps_for_range(&self, start: &str, end: &str, limit: i64) -> Vec<(String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT process_name, SUM(seconds_used) as total FROM ApplicationUsage
             WHERE date >= ?1 AND date <= ?2 GROUP BY process_name ORDER BY total DESC LIMIT ?3"
        ).unwrap();
        stmt.query_map(params![start, end, limit], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_daily_usage_rows(&self) -> Vec<(String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT date, total_seconds FROM DailyUsage ORDER BY date ASC").unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_app_usage_rows(&self) -> Vec<(String, String, String, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date, process_name, exe_path, seconds_used FROM ApplicationUsage ORDER BY date ASC, seconds_used DESC"
        ).unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn clear_usage_data(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("
            DELETE FROM DailyUsage;
            DELETE FROM ApplicationUsage;
            UPDATE Settings SET value = '' WHERE key = 'last_goal_alert_date';
        ")?;
        Ok(())
    }

    pub fn vacuum(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("VACUUM;")?;
        Ok(())
    }

    pub fn backup_to(&self, dest_path: &str) -> std::result::Result<(), String> {
        let mut dest_conn = Connection::open(dest_path).map_err(|e| e.to_string())?;
        let src_conn = self.conn.lock().unwrap();
        let _ = src_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dest_conn).map_err(|e| e.to_string())?;
        backup.run_to_completion(100, std::time::Duration::from_millis(50), None).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn restore_from(&self, src_path: &str) -> std::result::Result<(), String> {
        let src_conn = Connection::open(src_path).map_err(|e| e.to_string())?;
        let mut dest_conn = self.conn.lock().unwrap();
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut dest_conn).map_err(|e| e.to_string())?;
        backup.run_to_completion(100, std::time::Duration::from_millis(50), None).map_err(|e| e.to_string())?;
        drop(backup);
        let _ = dest_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        Ok(())
    }
}
