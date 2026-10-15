// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod tracker;
mod features;
mod platform;

use std::sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}};
use tauri::{Manager, Emitter};
use tauri_plugin_autostart::MacosLauncher;
use db::Database;
use features::FeatureManager;

static IS_QUITTING: AtomicBool = AtomicBool::new(false);
static HIDE_GEN: AtomicU64 = AtomicU64::new(0);

pub struct AppState {
    pub db: Mutex<Database>,
    pub is_paused: AtomicBool,
    pub paused_until: Mutex<Option<chrono::DateTime<chrono::Local>>>,
}

#[tauri::command]
fn get_today_usage(state: tauri::State<Arc<AppState>>) -> i64 {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    state.db.lock().unwrap().get_today_usage(&today)
}

#[tauri::command]
fn get_app_usage_by_date(state: tauri::State<Arc<AppState>>, date: String) -> Vec<(String, String, i64)> {
    state.db.lock().unwrap().get_today_app_usage(&date)
}

#[tauri::command]
fn get_history(state: tauri::State<Arc<AppState>>, start: String, end: String) -> Vec<(String, i64)> {
    state.db.lock().unwrap().get_history_for_range(&start, &end)
}

#[tauri::command]
fn get_app_history(state: tauri::State<Arc<AppState>>, process_name: String, start: String, end: String) -> Vec<(String, i64)> {
    state.db.lock().unwrap().get_app_history_for_range(&process_name, &start, &end)
}

#[tauri::command]
fn get_app_icon(exe_path: String) -> String {
    use win_icon_extractor::extract_icon;
    use image::RgbaImage;
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    use std::io::Cursor;
    
    if let Ok(icon) = extract_icon(&exe_path) {
        if let Some(img) = RgbaImage::from_raw(icon.width, icon.height, icon.rgba) {
            let mut buf = Cursor::new(Vec::new());
            if image::write_buffer_with_format(&mut buf, &img, icon.width, icon.height, image::ColorType::Rgba8, image::ImageFormat::Png).is_ok() {
                let b64 = BASE64.encode(buf.into_inner());
                return format!("data:image/png;base64,{}", b64);
            }
        }
    }
    "".into()
}

#[tauri::command]
fn get_settings(state: tauri::State<Arc<AppState>>) -> std::collections::HashMap<String, String> {
    state.db.lock().unwrap().get_all_settings()
}

#[tauri::command]
fn set_setting(state: tauri::State<Arc<AppState>>, key: String, value: String) -> Result<(), String> {
    state.db.lock().unwrap().set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_data(state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    state.db.lock().unwrap().clear_usage_data().map_err(|e| e.to_string())
}

fn set_paused_internal(app_handle: &tauri::AppHandle, state: &Arc<AppState>, mins: i64) {
    if mins > 0 {
        let until = chrono::Local::now() + chrono::Duration::minutes(mins);
        *state.paused_until.lock().unwrap() = Some(until);
        state.is_paused.store(true, Ordering::Relaxed);
        let _ = app_handle.emit("pause-state-changed", Some(until.to_rfc3339()));
    } else {
        *state.paused_until.lock().unwrap() = None;
        state.is_paused.store(false, Ordering::Relaxed);
        let _ = app_handle.emit("pause-state-changed", None::<String>);
    }
}

#[tauri::command]
fn set_paused(app_handle: tauri::AppHandle, state: tauri::State<Arc<AppState>>, mins: i64) {
    set_paused_internal(&app_handle, &state, mins);
}

#[tauri::command]
fn is_paused(state: tauri::State<Arc<AppState>>) -> Option<String> {
    if state.is_paused.load(Ordering::Relaxed) {
        state.paused_until.lock().unwrap().map(|d| d.to_rfc3339())
    } else {
        None
    }
}

#[derive(serde::Serialize, Clone, PartialEq, Eq, Debug)]
pub struct SystemInfo {
    pub accent_color: String,
    pub dark_mode: bool,
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    use winreg::RegKey;
    use winreg::enums::*;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut dark_mode = false;
    if let Ok(theme) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") {
        if let Ok(apps_use_light) = theme.get_value::<u32, _>("AppsUseLightTheme") {
            dark_mode = apps_use_light == 0;
        } else if let Ok(sys_use_light) = theme.get_value::<u32, _>("SystemUsesLightTheme") {
            dark_mode = sys_use_light == 0;
        }
    }

    let mut accent_color = None;

    // 1. Try Explorer AccentColorMenu (Windows 10 & 11 active accent color, ABGR)
    if let Ok(acc) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent") {
        if let Ok(color) = acc.get_value::<u32, _>("AccentColorMenu") {
            let r = (color & 0xFF) as u8;
            let g = ((color >> 8) & 0xFF) as u8;
            let b = ((color >> 16) & 0xFF) as u8;
            accent_color = Some(format!("#{:02X}{:02X}{:02X}", r, g, b));
        }
    }

    // 2. Try DWM AccentColor (ABGR)
    if accent_color.is_none() {
        if let Ok(dwm) = hkcu.open_subkey(r"Software\Microsoft\Windows\DWM") {
            if let Ok(color) = dwm.get_value::<u32, _>("AccentColor") {
                let r = (color & 0xFF) as u8;
                let g = ((color >> 8) & 0xFF) as u8;
                let b = ((color >> 16) & 0xFF) as u8;
                accent_color = Some(format!("#{:02X}{:02X}{:02X}", r, g, b));
            }
        }
    }

    // 3. Fallback to DWM ColorizationColor (ARGB)
    if accent_color.is_none() {
        if let Ok(dwm) = hkcu.open_subkey(r"Software\Microsoft\Windows\DWM") {
            if let Ok(color) = dwm.get_value::<u32, _>("ColorizationColor") {
                let r = ((color >> 16) & 0xFF) as u8;
                let g = ((color >> 8) & 0xFF) as u8;
                let b = (color & 0xFF) as u8;
                accent_color = Some(format!("#{:02X}{:02X}{:02X}", r, g, b));
            }
        }
    }

    SystemInfo {
        accent_color: accent_color.unwrap_or_else(|| String::from("#0078D7")),
        dark_mode,
    }
}

#[tauri::command]
async fn export_csv(state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(path) = app.dialog().file().blocking_pick_folder() {
        let path = path.into_path().unwrap();
        crate::features::data_management::export_to_csv(&state, &path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn export_db(state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(path) = app.dialog().file().add_filter("SQLite DB", &["db"]).blocking_save_file() {
        let path = path.into_path().map_err(|e| e.to_string())?;
        let db = state.db.lock().unwrap();
        db.backup_to(path.to_str().ok_or("Invalid path")?)?;
    }
    Ok(())
}

#[tauri::command]
async fn import_db(state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(path) = app.dialog().file().add_filter("SQLite DB", &["db"]).blocking_pick_file() {
        let path = path.into_path().map_err(|e| e.to_string())?;
        let db = state.db.lock().unwrap();
        db.restore_from(path.to_str().ok_or("Invalid path")?)?;
    }
    Ok(())
}

#[tauri::command]
async fn export_settings(state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(path) = app.dialog().file().add_filter("JSON Settings", &["json"]).blocking_save_file() {
        let path = path.into_path().map_err(|e| e.to_string())?;
        let settings = state.db.lock().unwrap().get_all_settings();
        let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn import_settings(state: tauri::State<'_, Arc<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(path) = app.dialog().file().add_filter("JSON Settings", &["json"]).blocking_pick_file() {
        let path = path.into_path().map_err(|e| e.to_string())?;
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let map: std::collections::HashMap<String, String> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let db = state.db.lock().unwrap();
        for (k, v) in map {
            let _ = db.set_setting(&k, &v);
        }
    }
    Ok(())
}

#[tauri::command]
fn show_system_menu(window: tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::{HWND, POINT, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, GetSystemMenu, SetForegroundWindow, SendMessageW, TrackPopupMenu,
            TPM_LEFTBUTTON, TPM_RETURNCMD, WM_SYSCOMMAND, GetWindowLongW, SetWindowLongW,
            GWL_STYLE, IsZoomed, IsIconic, EnableMenuItem, MENU_ITEM_FLAGS,
            SC_RESTORE, SC_MOVE, SC_SIZE, SC_MINIMIZE, SC_MAXIMIZE, SC_CLOSE,
        };

        if let Ok(h) = window.hwnd() {
            let hwnd = HWND(h.0 as *mut _);
            let _ = SetForegroundWindow(hwnd);

            // Ensure window has WS_SYSMENU style
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            const WS_SYSMENU_VAL: u32 = 0x00080000;
            if (style & WS_SYSMENU_VAL) == 0 {
                SetWindowLongW(hwnd, GWL_STYLE, (style | WS_SYSMENU_VAL) as i32);
            }

            let mut hmenu = GetSystemMenu(hwnd, false);
            if hmenu.is_invalid() || hmenu.0.is_null() {
                let _ = GetSystemMenu(hwnd, true);
                hmenu = GetSystemMenu(hwnd, false);
            }

            if !hmenu.is_invalid() && !hmenu.0.is_null() {
                let is_max = IsZoomed(hwnd).as_bool();
                let is_min = IsIconic(hwnd).as_bool();

                const MF_BYCOMMAND_VAL: u32 = 0x00000000;
                const MF_ENABLED_VAL: u32 = 0x00000000;
                const MF_GRAYED_VAL: u32 = 0x00000001;

                let enable_flag = |enabled: bool| -> MENU_ITEM_FLAGS {
                    MENU_ITEM_FLAGS(MF_BYCOMMAND_VAL | if enabled { MF_ENABLED_VAL } else { MF_GRAYED_VAL })
                };

                let _ = EnableMenuItem(hmenu, SC_RESTORE, enable_flag(is_max || is_min));
                let _ = EnableMenuItem(hmenu, SC_MOVE, enable_flag(!is_max && !is_min));
                let _ = EnableMenuItem(hmenu, SC_SIZE, enable_flag(!is_max && !is_min));
                let _ = EnableMenuItem(hmenu, SC_MINIMIZE, enable_flag(!is_min));
                let _ = EnableMenuItem(hmenu, SC_MAXIMIZE, enable_flag(!is_max));
                let _ = EnableMenuItem(hmenu, SC_CLOSE, enable_flag(true));

                let mut pt = POINT::default();
                let _ = GetCursorPos(&mut pt);
                let cmd = TrackPopupMenu(
                    hmenu,
                    TPM_RETURNCMD | TPM_LEFTBUTTON,
                    pt.x,
                    pt.y,
                    0,
                    hwnd,
                    None,
                );
                if cmd.0 != 0 {
                    let _ = SendMessageW(
                        hwnd,
                        WM_SYSCOMMAND,
                        WPARAM(cmd.0 as usize),
                        LPARAM(0),
                    );
                }
            }
        }
    }
}

fn show_or_create_dashboard(app: &tauri::AppHandle) {
    HIDE_GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("visibility-changed", true);
    } else {
        match tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
            .title("Active Screen Time")
            .inner_size(800.0, 600.0)
            .center()
            .decorations(false)
            .transparent(true)
            .shadow(true)
            .visible(true)
            .build()
        {
            Ok(window) => {
                let _ = window.set_focus();
                let _ = window.emit("visibility-changed", true);
            }
            Err(e) => {
                eprintln!("Failed to recreate main window: {:?}", e);
            }
        }
    }
}

pub static GLOBAL_APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub fn show_dashboard() {
    if let Some(app) = GLOBAL_APP_HANDLE.get() {
        show_or_create_dashboard(app);
    }
}

fn build_monthly_report_payload(db: &Database) -> serde_json::Value {
    let now = chrono::Local::now();
    let current_month = now.format("%Y-%m").to_string();
    let month_name = now.format("%B %Y").to_string();
    let today = now.format("%Y-%m-%d").to_string();
    let start = format!("{}-01", current_month);

    let total_secs = db.get_total_usage_for_range(&start, &today);
    let top_apps_raw = db.get_top_apps_for_range(&start, &today, 5);
    let history = db.get_history_for_range(&start, &today);

    let active_days = history.iter().filter(|(_, s)| *s > 0).count() as i64;
    let most_active = history.iter().max_by_key(|(_, s)| *s);
    let most_active_day = most_active.map(|(d, s)| {
        let h = s / 3600;
        let m = (s % 3600) / 60;
        let time_str = if h > 0 { format!("{}h {}m", h, m) } else { format!("{}m", m) };
        format!("{} ({})", d, time_str)
    }).unwrap_or_else(|| "N/A".to_string());

    let hours = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    let avg_secs = if active_days > 0 { total_secs / active_days } else { total_secs / 30 };
    let avg_hours = avg_secs / 3600;
    let avg_mins = (avg_secs % 3600) / 60;

    let top_apps: Vec<serde_json::Value> = top_apps_raw.into_iter().map(|(name, s)| {
        let app_h = s / 3600;
        let app_m = (s % 3600) / 60;
        let time_str = if app_h > 0 { format!("{}h {}m", app_h, app_m) } else { format!("{}m", app_m) };
        let pct = if total_secs > 0 { (s * 100) / total_secs } else { 0 };
        serde_json::json!({
            "name": name,
            "secs": s,
            "time_str": time_str,
            "pct": pct
        })
    }).collect();

    serde_json::json!({
        "month_name": month_name,
        "hours": hours,
        "mins": mins,
        "total_secs": total_secs,
        "active_days": active_days,
        "avg_hours": avg_hours,
        "avg_mins": avg_mins,
        "most_active_day": most_active_day,
        "top_apps": top_apps
    })
}

#[tauri::command]
fn get_monthly_report(state: tauri::State<Arc<AppState>>) -> serde_json::Value {
    let db = state.db.lock().unwrap();
    build_monthly_report_payload(&db)
}

fn main() {
    // Resolve DB path
    let local_app_data = dirs_next::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let db_dir = local_app_data.join("Flunty").join("ActiveScreenTime");
    std::fs::create_dir_all(&db_dir).unwrap_or_default();
    let db_path = db_dir.join("data.db");

    let db = Database::new(db_path.to_str().unwrap()).expect("Failed to open SQLite db");

    let app_state = Arc::new(AppState {
        db: Mutex::new(db),
        is_paused: AtomicBool::new(false),
        paused_until: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_or_create_dashboard(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::clone(&app_state))
        .invoke_handler(tauri::generate_handler![
            get_today_usage,
            get_app_usage_by_date,
            get_history,
            get_app_history,
            get_app_icon,
            get_settings,
            set_setting,
            reset_data,
            set_paused,
            is_paused,
            get_system_info,
            export_csv,
            export_db,
            import_db,
            export_settings,
            import_settings,
            show_system_menu,
            get_monthly_report
        ])
        .setup(move |app| {
            GLOBAL_APP_HANDLE.set(app.handle().clone()).ok();
            platform::init_platform();

            use std::thread;
            use crossbeam_channel::unbounded;
            
            // System Tray
            use tauri::menu::{Menu, MenuItem, Submenu};

            let pause_5m = MenuItem::with_id(app, "pause_5m", "For 5 minutes", true, None::<&str>)?;
            let pause_15m = MenuItem::with_id(app, "pause_15m", "For 15 minutes", true, None::<&str>)?;
            let pause_30m = MenuItem::with_id(app, "pause_30m", "For 30 minutes", true, None::<&str>)?;
            let pause_1h = MenuItem::with_id(app, "pause_1h", "For 1 hour", true, None::<&str>)?;
            let pause_tomorrow = MenuItem::with_id(app, "pause_tomorrow", "Until tomorrow", true, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume Tracking", true, None::<&str>)?;

            let pause_menu = Submenu::with_items(app, "Pause Tracking", true, &[
                &pause_5m,
                &pause_15m,
                &pause_30m,
                &pause_1h,
                &pause_tomorrow,
                &resume,
            ])?;

            let tray_menu = Menu::with_items(app, &[
                &MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?,
                &pause_menu,
                &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;

            let app_state_for_tray = Arc::clone(&app_state);
            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        show_or_create_dashboard(app);
                    }
                    "quit" => {
                        IS_QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    "pause_5m" => set_paused_internal(app, &app_state_for_tray, 5),
                    "pause_15m" => set_paused_internal(app, &app_state_for_tray, 15),
                    "pause_30m" => set_paused_internal(app, &app_state_for_tray, 30),
                    "pause_1h" => set_paused_internal(app, &app_state_for_tray, 60),
                    "pause_tomorrow" => {
                        let now = chrono::Local::now();
                        let tomorrow = now.date_naive() + chrono::Duration::days(1);
                        if let Some(tomorrow_midnight) = tomorrow.and_hms_opt(0, 0, 0) {
                            if let Some(tz_tomorrow) = tomorrow_midnight.and_local_timezone(chrono::Local).single() {
                                let mins = (tz_tomorrow - now).num_minutes();
                                set_paused_internal(app, &app_state_for_tray, mins);
                            }
                        }
                    }
                    "resume" => set_paused_internal(app, &app_state_for_tray, 0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        show_or_create_dashboard(tray.app_handle());
                    }
                })
                .build(app)?;
            
            let handle = app.handle().clone();
            let state_for_tracker = Arc::clone(&app_state);
            let (tx, rx) = unbounded();

            thread::spawn(move || {
                tracker::run_tracker(state_for_tracker, tx);
            });

            let mut features = FeatureManager::new();
            let state_for_features = Arc::clone(&app_state);
            thread::spawn(move || {
                while let Ok(event) = rx.recv() {
                    let alerts = features.tick(&state_for_features, &event);
                    for alert in alerts {
                        match alert {
                            features::FeatureAlert::GoalReached => {
                                platform::notify("Screen Time Goal", "You have reached your daily screen time goal.");
                                let goal_mins: i64 = state_for_features.db.lock().unwrap()
                                    .get_setting_or("goal_minutes", "240")
                                    .parse()
                                    .unwrap_or(240);
                                let h = goal_mins / 60;
                                let m = goal_mins % 60;
                                let msg = if h > 0 && m > 0 {
                                    format!("You have reached your daily screen time goal of {}h {}m!", h, m)
                                } else if h > 0 {
                                    format!("You have reached your daily screen time goal of {}h!", h)
                                } else {
                                    format!("You have reached your daily screen time goal of {}m!", m)
                                };
                                std::thread::spawn(move || {
                                    platform::alert_always_on_top("Daily Screen Time Goal Reached", &msg);
                                });
                            }
                            features::FeatureAlert::BreakDue => {
                                std::thread::spawn(|| {
                                    platform::alert_always_on_top(
                                        "Break Reminder",
                                        "You've been active for a long time. Time to take a break and rest your eyes.",
                                    );
                                });
                            }
                            features::FeatureAlert::MonthlyReport { total_secs: _ } => {
                                let payload = {
                                    let db = state_for_features.db.lock().unwrap();
                                    build_monthly_report_payload(&db)
                                };

                                let month_name = payload["month_name"].as_str().unwrap_or("this month");
                                let hours = payload["hours"].as_i64().unwrap_or(0);
                                let mins = payload["mins"].as_i64().unwrap_or(0);
                                let toast_msg = format!("Your total screen time for {} is {}h {}m. Click to view detailed summary.", month_name, hours, mins);
                                platform::notify("Monthly Screen Time Report", &toast_msg);

                                let report_str = payload.to_string();
                                state_for_features.db.lock().unwrap().set_setting("pending_monthly_report", &report_str).ok();

                                let _ = handle.emit("monthly-report", payload);
                            }
                            _ => {}
                        }
                    }
                    
                    #[derive(serde::Serialize, Clone)]
                    struct TrackerPayload {
                        status: String,
                        app: String,
                    }
                    
                    let payload = match &event {
                        tracker::TrackerEvent::Active { process_name, .. } => TrackerPayload {
                            status: "active".into(),
                            app: process_name.clone(),
                        },
                        tracker::TrackerEvent::Idle { .. } => TrackerPayload {
                            status: "idle".into(),
                            app: "".into(),
                        },
                    };
                    
                    let _ = handle.emit("tracker-event", payload);
                }
            });

            let handle_for_theme = app.handle().clone();
            thread::spawn(move || {
                let mut last_info = get_system_info();
                loop {
                    thread::sleep(std::time::Duration::from_millis(500));
                    let current_info = get_system_info();
                    if current_info != last_info {
                        let _ = handle_for_theme.emit("system-theme-changed", &current_info);
                        last_info = current_info;
                    }
                }
            });

            let is_autostart = std::env::args().any(|arg| arg == "--autostart" || arg == "--hidden" || arg == "--minimized");
            if is_autostart {
                let current_gen = HIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    if HIDE_GEN.load(Ordering::SeqCst) == current_gen {
                        let h = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            if HIDE_GEN.load(Ordering::SeqCst) == current_gen {
                                if let Some(win) = h.get_webview_window("main") {
                                    if !win.is_visible().unwrap_or(false) {
                                        let _ = win.destroy();
                                    }
                                }
                            }
                        });
                    }
                });
            } else {
                show_or_create_dashboard(&app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                let _ = window.emit("visibility-changed", false);
                api.prevent_close();

                // Kill webview2 process after 30 seconds of inactivity to reclaim RAM
                let current_gen = HIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                let handle = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    if HIDE_GEN.load(Ordering::SeqCst) == current_gen {
                        let h = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            if HIDE_GEN.load(Ordering::SeqCst) == current_gen {
                                if let Some(win) = h.get_webview_window("main") {
                                    if !win.is_visible().unwrap_or(false) {
                                        let _ = win.destroy();
                                    }
                                }
                            }
                        });
                    }
                });
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !IS_QUITTING.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
