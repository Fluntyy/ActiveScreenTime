//! Windows-specific tracking implementation.
//! Uses Win32 APIs for:
//!   - Idle time: GetLastInputInfo
//!   - Foreground window: GetForegroundWindow + QueryFullProcessImageName
//!   - True fullscreen detection: window style flags (WS_POPUP without WS_CAPTION)
//!   - Media detection: Windows SMTC (GlobalSystemMediaTransportControlsSessionManager)

use std::sync::{Arc, RwLock, atomic::Ordering};
use std::time::{Duration, Instant};
use crossbeam_channel::Sender;
use chrono::Local;

use windows::Win32::Foundation::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::Win32::System::Threading::*;
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::Graphics::Gdi::*;

use crate::tracker::{TrackerEvent, IdleReason, TrackContext, should_count};
use crate::AppState;

/// Get idle time in seconds
fn get_idle_seconds() -> f64 {
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii).as_bool() {
            let tick = GetTickCount();
            let diff = tick.wrapping_sub(lii.dwTime);
            return diff as f64 / 1000.0;
        }
        0.0
    }
}


/// Get the foreground window's process name, exe path, title, PID
fn get_foreground_info(own_pid: u32) -> Option<(String, String, String, u32)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == std::ptr::null_mut() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        // Skip our own window
        if pid == own_pid || pid == 0 {
            return None;
        }

        let title = {
            let mut buf = vec![0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..len as usize])
        };

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        let (exe_path, raw_name) = if let Ok(h) = process {
            let mut buf = vec![0u16; 1024];
            let mut size = buf.len() as u32;
            let exe = if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size).is_ok() {
                String::from_utf16_lossy(&buf[..size as usize])
            } else {
                String::new()
            };
            let name = std::path::Path::new(&exe)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let _ = CloseHandle(h);
            (exe, name)
        } else {
            (String::new(), String::new())
        };

        // Resolve friendly name via file description
        let friendly_name = get_friendly_name(&exe_path, &raw_name);

        Some((friendly_name, exe_path, title, pid))
    }
}

use std::sync::Mutex;
use std::collections::HashMap;

static APP_NAME_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub fn clean_app_name(raw: &str) -> String {
    let mut name = raw.trim().to_string();
    if name.to_lowercase().ends_with(".exe") {
        name.truncate(name.len() - 4);
    }
    if name.ends_with(".Root") || name.ends_with(".root") {
        name.truncate(name.len() - 5);
    }
    name
}

/// Get file description (friendly app name) from PE version info, e.g. "Task Manager" instead of "Taskmgr"
pub fn get_friendly_name(exe_path: &str, fallback: &str) -> String {
    if exe_path.is_empty() {
        return clean_app_name(fallback);
    }

    if let Ok(mut lock) = APP_NAME_CACHE.lock() {
        let cache = lock.get_or_insert_with(HashMap::new);
        if let Some(cached) = cache.get(exe_path) {
            return cached.clone();
        }
    }

    let resolved = get_pe_file_description(exe_path)
        .map(|s| clean_app_name(&s))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            // Strip .exe and capitalize as fallback
            let raw_stem = std::path::Path::new(exe_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(fallback);
            let cleaned = clean_app_name(raw_stem);
            if cleaned.is_empty() {
                return fallback.to_string();
            }
            // Capitalize words separated by spaces or underscores
            cleaned.split([' ', '_'])
                .filter(|w| !w.is_empty())
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        });

    if let Ok(mut lock) = APP_NAME_CACHE.lock() {
        if let Some(cache) = lock.as_mut() {
            cache.insert(exe_path.to_string(), resolved.clone());
        }
    }

    resolved
}

fn get_pe_file_description(exe_path: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

    unsafe {
        let path_hstring = HSTRING::from(exe_path);
        let size = GetFileVersionInfoSizeW(&path_hstring, None);
        if size == 0 {
            return None;
        }

        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(&path_hstring, 0, size, data.as_mut_ptr() as *mut _).is_err() {
            return None;
        }

        let mut sub_blocks: Vec<String> = Vec::new();

        // Query translation block to get correct lang/codepage
        let mut trans_ptr = std::ptr::null_mut();
        let mut trans_len = 0u32;
        if VerQueryValueW(
            data.as_ptr() as *const _,
            windows::core::w!("\\VarFileInfo\\Translation"),
            &mut trans_ptr,
            &mut trans_len,
        ).as_bool() && trans_len >= 4 && !trans_ptr.is_null() {
            let trans_slice = std::slice::from_raw_parts(trans_ptr as *const u16, (trans_len as usize) / 2);
            for chunk in trans_slice.chunks(2) {
                if chunk.len() == 2 {
                    let lang = chunk[0];
                    let cp = chunk[1];
                    sub_blocks.push(format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", lang, cp));
                    sub_blocks.push(format!("\\StringFileInfo\\{:04X}{:04X}\\FileDescription", lang, cp));
                    sub_blocks.push(format!("\\StringFileInfo\\{:04x}{:04x}\\ProductName", lang, cp));
                }
            }
        }

        // Common default code pages as fallbacks
        sub_blocks.push(String::from("\\StringFileInfo\\040904b0\\FileDescription"));
        sub_blocks.push(String::from("\\StringFileInfo\\040904E4\\FileDescription"));
        sub_blocks.push(String::from("\\StringFileInfo\\000004b0\\FileDescription"));
        sub_blocks.push(String::from("\\StringFileInfo\\040904b0\\ProductName"));

        for block in sub_blocks {
            let block_h = HSTRING::from(block.as_str());
            let mut val_ptr = std::ptr::null_mut();
            let mut val_len = 0u32;
            if VerQueryValueW(
                data.as_ptr() as *const _,
                windows::core::PCWSTR(block_h.as_ptr()),
                &mut val_ptr,
                &mut val_len,
            ).as_bool() && val_len > 0 && !val_ptr.is_null() {
                let slice = std::slice::from_raw_parts(val_ptr as *const u16, val_len as usize);
                let text = String::from_utf16_lossy(slice);
                let clean = text.trim_matches('\0').trim();
                if !clean.is_empty() {
                    return Some(clean.to_string());
                }
            }
        }

        None
    }
}

/// True fullscreen detection (e.g. Brave/Chrome F11, YouTube fullscreen, games, video players).
/// Uses official Windows Notification State API combined with window bounds and style checks.
fn is_true_fullscreen(hwnd: HWND) -> bool {
    unsafe {
        if hwnd.0.is_null() || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return false;
        }

        if hwnd == GetDesktopWindow() || hwnd == GetShellWindow() {
            return false;
        }

        // 1. Direct query of Windows User Notification State API.
        // Fullscreen DirectX games and presentation modes return BUSY, D3D_FULL_SCREEN, or PRESENTATION_MODE.
        use windows::Win32::UI::Shell::{
            SHQueryUserNotificationState,
            QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE,
        };
        if let Ok(qstate) = SHQueryUserNotificationState() {
            if qstate == QUNS_BUSY || qstate == QUNS_RUNNING_D3D_FULL_SCREEN || qstate == QUNS_PRESENTATION_MODE {
                return true;
            }
        }

        // 2. Check window bounds against monitor bounds.
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return false;
        }

        let mr = mi.rcMonitor;
        // Allow a 10px margin of tolerance for DWM drop shadows, VM display adapters, and multi-monitor DPI scaling.
        let fills_monitor = rect.left <= mr.left + 10
            && rect.top <= mr.top + 10
            && rect.right >= mr.right - 10
            && rect.bottom >= mr.bottom - 10;

        if !fills_monitor {
            return false;
        }

        // 3. Distinguish Maximized vs True Fullscreen:
        // A maximized window (even when the taskbar is auto-hidden) maintains WS_CAPTION (title bar, tabs, controls).
        // True fullscreen windows (Chromium F11, HTML5/YouTube fullscreen, VLC fullscreen, borderless games)
        // explicitly strip WS_CAPTION.
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let has_caption = (style & WS_CAPTION.0) == WS_CAPTION.0;
        if !has_caption {
            return true;
        }

        false
    }
}

/// SMTC media detection.
/// Polls GlobalSystemMediaTransportControlsSessionManager asynchronously in a background thread.
/// Stores lowercased SourceAppUserModelId strings of all sessions currently in Playing status.
pub fn spawn_smtc_watcher() -> Arc<RwLock<Vec<String>>> {
    let playing_sources = Arc::new(RwLock::new(Vec::new()));
    let sources_clone = Arc::clone(&playing_sources);

    std::thread::spawn(move || {
        // Initialize COM/WinRT for this thread
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
        }

        loop {
            let active = get_playing_sources();
            if let Ok(mut lock) = sources_clone.write() {
                *lock = active;
            }
            std::thread::sleep(Duration::from_millis(1000));
        }
    });

    playing_sources
}

fn get_playing_sources() -> Vec<String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    let result: Result<Vec<String>, _> = (|| -> windows::core::Result<Vec<String>> {
        let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?;
        let manager = op.get()?;
        let mut sources = Vec::new();

        if let Ok(sessions) = manager.GetSessions() {
            for session in sessions {
                if let Ok(info) = session.GetPlaybackInfo() {
                    if let Ok(status) = info.PlaybackStatus() {
                        if status == Status::Playing {
                            if let Ok(app_id) = session.SourceAppUserModelId() {
                                let id = app_id.to_string().to_lowercase();
                                if !id.is_empty() {
                                    sources.push(id);
                                }
                            }
                        }
                    }
                }
            }
        }

        if sources.is_empty() {
            if let Ok(session) = manager.GetCurrentSession() {
                if let Ok(info) = session.GetPlaybackInfo() {
                    if let Ok(status) = info.PlaybackStatus() {
                        if status == Status::Playing {
                            if let Ok(app_id) = session.SourceAppUserModelId() {
                                let id = app_id.to_string().to_lowercase();
                                if !id.is_empty() {
                                    sources.push(id);
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(sources)
    })();

    result.unwrap_or_default()
}

fn is_foreground_app_playing(
    sources: &[String],
    process_name: &str,
    exe_path: &str,
) -> bool {
    if sources.is_empty() {
        return false;
    }

    let proc_lower = process_name.to_lowercase();
    let exe_lower = exe_path.to_lowercase();
    let stem = std::path::Path::new(&exe_lower)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    for src in sources {
        // AppUserModelId could be "brave.exe", "BraveSoftware.BraveBrowser", "spotify.exe", etc.
        if !stem.is_empty() && stem.len() >= 3 && src.contains(&stem) {
            return true;
        }
        if !proc_lower.is_empty() && proc_lower.len() >= 3 && src.contains(&proc_lower) {
            return true;
        }
        if src.len() >= 3 && (exe_lower.contains(src) || proc_lower.contains(src)) {
            return true;
        }
    }

    false
}

/// Main tracker loop — run this in a dedicated thread
pub fn run_tracker(
    state: Arc<AppState>,
    tx: Sender<TrackerEvent>,
) {
    let own_pid = std::process::id();
    let playing_sources = spawn_smtc_watcher();

    let mut usage_buffer: std::collections::HashMap<(String, String), i64> = std::collections::HashMap::new();
    let mut seconds_since_flush = 0i64;
    const FLUSH_INTERVAL: i64 = 10;

    loop {
        let loop_start = Instant::now();

        let paused = state.is_paused.load(Ordering::Relaxed);

        // Check if timed pause has expired
        {
            let mut until = state.paused_until.lock().unwrap();
            if let Some(t) = *until {
                if Local::now() >= t {
                    *until = None;
                    state.is_paused.store(false, Ordering::Relaxed);
                }
            }
        }

        if paused || state.is_paused.load(Ordering::Relaxed) {
            let _ = tx.send(TrackerEvent::Idle { reason: IdleReason::Paused });
        } else {
            let idle_secs = get_idle_seconds();

            if let Some((process_name, exe_path, title, pid)) = get_foreground_info(own_pid) {
                let mut should_ignore = false;
                
                let disable_windows_apps = state.db.lock().unwrap().get_setting_or("disable_windows_apps", "0") == "1";
                let exclude_regex_str = state.db.lock().unwrap().get_setting_or("exclude_regex", "");

                if state.db.lock().unwrap().get_setting_or("ignore_lockapp", "1") == "1" && exe_path.to_lowercase().ends_with("lockapp.exe") {
                    should_ignore = true;
                }
                if state.db.lock().unwrap().get_setting_or("ignore_searchhost", "1") == "1" && exe_path.to_lowercase().ends_with("searchhost.exe") {
                    should_ignore = true;
                }
                if state.db.lock().unwrap().get_setting_or("ignore_shellhost", "1") == "1" && exe_path.to_lowercase().ends_with("shellhost.exe") {
                    should_ignore = true;
                }
                if state.db.lock().unwrap().get_setting_or("ignore_shellexperiencehost", "1") == "1" && exe_path.to_lowercase().ends_with("shellexperiencehost.exe") {
                    should_ignore = true;
                }

                if disable_windows_apps && exe_path.to_lowercase().contains("applicationframehost.exe") {
                    should_ignore = true;
                }

                if !should_ignore && !exclude_regex_str.is_empty() {
                    // basic substring match since rust regex is not imported, let's add regex to cargo?
                    // I will just use string contains or add regex later if needed. Wait, regex crate is not in cargo.toml?
                    // Oh, I will add regex to cargo.toml
                    if let Ok(re) = regex::Regex::new(&exclude_regex_str) {
                        if re.is_match(&process_name) || re.is_match(&title) || re.is_match(&exe_path) {
                            should_ignore = true;
                        }
                    }
                }

                if should_ignore {
                    let _ = tx.send(TrackerEvent::Idle { reason: IdleReason::SystemUI });
                } else {
                    let hwnd = unsafe { GetForegroundWindow() };
                    let fullscreen = is_true_fullscreen(hwnd);
                    
                    let active_sources = playing_sources.read().map(|l| l.clone()).unwrap_or_default();
                    let media = is_foreground_app_playing(&active_sources, &process_name, &exe_path);

                    let idle_timeout: u64 = state.db.lock().unwrap()
                        .get_setting("idle_timeout")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(300);

                    let count_fullscreen = state.db.lock().unwrap()
                        .get_setting_or("track_fullscreen", "1") == "1";

                    let track_media = state.db.lock().unwrap()
                        .get_setting_or("track_media", "0") == "1";

                    let js_rule = state.db.lock().unwrap().get_setting_or("js_rule", "");

                    let ctx = TrackContext {
                        process_name: process_name.clone(),
                        window_title: title.clone(),
                        exe_path: exe_path.clone(),
                        idle_seconds: idle_secs,
                        is_fullscreen: fullscreen,
                        media_playing: media && track_media,
                        pid,
                    };

                    if should_count(&ctx, idle_timeout, count_fullscreen, &js_rule) {
                        let key = (process_name.clone(), exe_path.clone());
                        *usage_buffer.entry(key).or_insert(0) += 1;
                        seconds_since_flush += 1;

                        let _ = tx.send(TrackerEvent::Active {
                            process_name,
                            exe_path,
                            window_title: title,
                            media_playing: media,
                        });
                    } else {
                        let _ = tx.send(TrackerEvent::Idle { reason: IdleReason::UserIdle });
                    }
                }
            } else {
                let _ = tx.send(TrackerEvent::Idle { reason: IdleReason::NoWindow });
            }
        }

        // Flush to DB every FLUSH_INTERVAL seconds
        if seconds_since_flush >= FLUSH_INTERVAL {
            flush_buffer(&state, &mut usage_buffer);
            seconds_since_flush = 0;
        }

        // Maintain ~1 second loop
        let elapsed = loop_start.elapsed();
        if elapsed < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_secs(1) - elapsed);
        }
    }
}

fn flush_buffer(state: &AppState, buffer: &mut std::collections::HashMap<(String, String), i64>) {
    if buffer.is_empty() {
        return;
    }
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let db = state.db.lock().unwrap();
    for ((proc, exe), secs) in buffer.drain() {
        let _ = db.log_usage(&today, &proc, &exe, secs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pe_desc() {
        let desc = get_pe_file_description("C:\\Windows\\explorer.exe");
        println!("explorer.exe PE desc: {:?}", desc);
        let desc_task = get_pe_file_description("C:\\Windows\\System32\\Taskmgr.exe");
        println!("Taskmgr.exe PE desc: {:?}", desc_task);
        let friendly = get_friendly_name("C:\\Windows\\System32\\Taskmgr.exe", "Taskmgr");
        println!("Taskmgr friendly: {}", friendly);
        let code_path = "C:\\Users\\Flunty\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
        let desc_code = get_pe_file_description(code_path);
        println!("Code.exe PE desc: {:?}", desc_code);
        let friendly_code = get_friendly_name(code_path, "Code");
        println!("Code.exe friendly: {}", friendly_code);
        assert_eq!(clean_app_name("Notepad.exe"), "Notepad");
        assert_eq!(clean_app_name("WhatsApp.Root"), "WhatsApp");
        let wa_path = "C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.2638.102.0_x64__cv1g1gvanyjgm\\WhatsApp.Root.exe";
        println!("wa_path: {:?}", get_pe_file_description(wa_path));
        let friendly_wa = get_friendly_name(wa_path, "WhatsApp.Root");
        println!("friendly_wa: {:?}", friendly_wa);

        let local_app_data = dirs_next::data_local_dir().unwrap();
        let db_path = local_app_data.join("Flunty").join("ActiveScreenTime").join("data.db");
        if db_path.exists() {
            let conn = rusqlite::Connection::open(&db_path).unwrap();
            let mut stmt = conn.prepare("SELECT date, process_name, exe_path, seconds_used FROM ApplicationUsage WHERE process_name LIKE '%WhatsApp%' OR exe_path LIKE '%WhatsApp%'").unwrap();
            let rows: Vec<(String, String, String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().filter_map(|r| r.ok()).collect();
            println!("WhatsApp DB rows: {:#?}", rows);
        }
    }
}
