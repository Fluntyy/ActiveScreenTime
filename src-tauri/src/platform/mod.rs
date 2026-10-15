#![allow(dead_code)]

#[cfg(windows)]
pub mod windows;

pub fn init_platform() {
    #[cfg(windows)]
    windows::set_app_user_model_id();
}

/// Cross-platform notification
pub fn notify(title: &str, body: &str) {
    #[cfg(windows)]
    windows::show_notification(title, body);
    #[cfg(not(windows))]
    {
        // Future: libnotify on Linux, NSUserNotificationCenter on macOS
        log::info!("NOTIFY [{title}]: {body}");
    }
}

/// Cross-platform autostart
pub fn set_autostart(enable: bool) {
    #[cfg(windows)]
    windows::set_autostart(enable);
}

/// Cross-platform strictly always-on-top modal alert
pub fn alert_always_on_top(title: &str, message: &str) {
    #[cfg(windows)]
    windows::show_always_on_top_alert(title, message);
    #[cfg(not(windows))]
    {
        println!("ALERT [{title}]: {message}");
    }
}
