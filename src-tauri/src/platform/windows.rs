//! Windows-specific platform integration:
//! - Single-instance detection via Named Pipe
//! - System tray notifications via Windows Toast API
//! - Registry autostart
//! - AppUserModelID

use std::sync::Arc;
use crate::AppState;

const PIPE_NAME: &str = r"\\.\pipe\Flunty.ActiveScreenTime.SingleInstance";
const APP_ID: &str = "Flunty.ActiveScreenTime";

pub fn set_app_user_model_id() {
    use winreg::RegKey;
    use winreg::enums::*;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    use windows::core::PCWSTR;

    let wide: Vec<u16> = APP_ID.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { let _ = SetCurrentProcessExplicitAppUserModelID(PCWSTR(wide.as_ptr())); }

    let icon_dir = dirs_next::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Flunty")
        .join("ActiveScreenTime");
    let _ = std::fs::create_dir_all(&icon_dir);
    let icon_path = icon_dir.join("app_icon.png");

    const ICON_BYTES: &[u8] = include_bytes!("../../icons/icon.png");
    if !icon_path.exists() {
        let _ = std::fs::write(&icon_path, ICON_BYTES);
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((key, _)) = hkcu.create_subkey(format!(r"Software\Classes\AppUserModelId\{}", APP_ID)) {
        let _ = key.set_value("DisplayName", &"Active Screen Time");
        let _ = key.set_value("IconUri", &icon_path.to_string_lossy().to_string());
        let _ = key.set_value("IconBackgroundColor", &"0");
    }
}

/// Try to signal an existing running instance via the named pipe.
/// Returns true if there was an existing instance.
pub fn signal_existing_instance() -> bool {
    use windows::Win32::Storage::FileSystem::*;
    use windows::Win32::Foundation::*;
    use windows::Win32::System::Pipes::WaitNamedPipeW;

    let pipe_name: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();

    // Check if the pipe exists (server is running)
    unsafe {
        if WaitNamedPipeW(
            windows::core::PCWSTR(pipe_name.as_ptr()),
            200, // wait up to 200ms
        ).as_bool() == false {
            return false; // No server, no existing instance
        }

        // Connect and send SHOW_DASHBOARD
        let handle = CreateFileW(
            windows::core::PCWSTR(pipe_name.as_ptr()),
            GENERIC_WRITE.0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            INVALID_HANDLE_VALUE,
        );

        if let Ok(h) = handle {
            let msg = b"SHOW_DASHBOARD";
            let mut written = 0u32;
            let _ = windows::Win32::Storage::FileSystem::WriteFile(
                h,
                Some(msg),
                Some(&mut written),
                None,
            );
            let _ = CloseHandle(h);
            return true;
        }
    }
    false
}

/// Start the named pipe IPC server in a background thread.
/// When "SHOW_DASHBOARD" is received, sets a flag that the UI polls.
pub fn start_ipc_server(_state: Arc<AppState>) {
    use windows::Win32::System::Pipes::*;
    use windows::Win32::Foundation::*;
    use windows::Win32::Storage::FileSystem::*;
    use windows::core::PCWSTR;

    std::thread::spawn(move || {
        let pipe_name: Vec<u16> = PIPE_NAME.encode_utf16().chain(std::iter::once(0)).collect();

        loop {
            let pipe = unsafe {
                CreateNamedPipeW(
                    PCWSTR(pipe_name.as_ptr()),
                    PIPE_ACCESS_INBOUND,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1,     // max instances
                    512,   // out buffer
                    512,   // in buffer
                    0,     // default timeout
                    None,  // security attributes
                )
            };

            if pipe.is_invalid() {
                std::thread::sleep(std::time::Duration::from_secs(1));
                continue;
            }

            unsafe {
                // Block until a client connects
                if windows::Win32::System::Pipes::ConnectNamedPipe(pipe, None).is_ok()
                    || windows::Win32::Foundation::GetLastError() == ERROR_PIPE_CONNECTED
                {
                    let mut buf = [0u8; 512];
                    let mut bytes_read = 0u32;
                    if windows::Win32::Storage::FileSystem::ReadFile(
                        pipe,
                        Some(&mut buf),
                        Some(&mut bytes_read),
                        None,
                    ).is_ok() {
                        let msg = std::str::from_utf8(&buf[..bytes_read as usize]).unwrap_or("");
                        if msg == "SHOW_DASHBOARD" {
                            crate::show_dashboard();
                        }
                    }
                }
                let _ = CloseHandle(pipe);
            }
        }
    });
}

// Active toast notifications kept alive for interactive click events
static ACTIVE_TOASTS: std::sync::Mutex<Vec<windows::UI::Notifications::ToastNotification>> =
    std::sync::Mutex::new(Vec::new());

/// Show a native Windows toast notification
pub fn show_notification(title: &str, body: &str) {
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Foundation::TypedEventHandler;

    set_app_user_model_id();

    let icon_dir = dirs_next::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Flunty")
        .join("ActiveScreenTime");
    let icon_path = icon_dir.join("app_icon.png");

    let icon_tag = if icon_path.exists() {
        format!(
            r#"<image placement="appLogoOverride" hint-crop="circle" src="file:///{}" />"#,
            icon_path.to_string_lossy().replace('\\', "/")
        )
    } else {
        String::new()
    };

    let xml_str = format!(
        r#"<toast activationType="foreground" launch="show_dashboard">
            <visual>
                <binding template="ToastGeneric">
                    <text>{}</text>
                    <text>{}</text>
                    {}
                    <text placement="attribution">Active Screen Time</text>
                </binding>
            </visual>
        </toast>"#,
        title.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"),
        body.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"),
        icon_tag,
    );

    let result: windows::core::Result<()> = (|| {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&windows::core::HSTRING::from(xml_str.as_str()))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;

        let handler = TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(
            move |_sender, _args| {
                crate::show_dashboard();
                Ok(())
            }
        );
        let _ = toast.Activated(&handler);

        if let Ok(mut list) = ACTIVE_TOASTS.lock() {
            if list.len() >= 10 {
                list.remove(0);
            }
            list.push(toast.clone());
        }

        let notifier = ToastNotificationManager::CreateToastNotifierWithId(
            &windows::core::HSTRING::from(APP_ID),
        )?;
        notifier.Show(&toast)?;
        Ok(())
    })();

    if let Err(e) = result {
        println!("Toast notification failed: {}", e);
    }
}

/// Show a native Windows modal alert that stays strictly always-on-top
pub fn show_always_on_top_alert(title: &str, message: &str) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            MessageBoxW, GetForegroundWindow, MB_OK, MB_ICONINFORMATION,
            MB_TOPMOST, MB_SETFOREGROUND, MB_SYSTEMMODAL,
        };
        use windows::core::HSTRING;

        let foreground = GetForegroundWindow();
        MessageBoxW(
            foreground,
            &HSTRING::from(message),
            &HSTRING::from(title),
            MB_OK | MB_ICONINFORMATION | MB_TOPMOST | MB_SETFOREGROUND | MB_SYSTEMMODAL,
        );
    }
}

/// Set or remove the app from Windows startup registry
pub fn set_autostart(enable: bool) {
    use winreg::RegKey;
    use winreg::enums::*;

    let result: Result<(), Box<dyn std::error::Error>> = (|| {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu.open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            KEY_SET_VALUE,
        )?;

        if enable {
            let exe = std::env::current_exe()?;
            let cmd = format!("\"{}\" --tray", exe.display());
            run_key.set_value("ActiveScreenTime", &cmd)?;
        } else {
            let _ = run_key.delete_value("ActiveScreenTime");
        }
        Ok(())
    })();

    if let Err(e) = result {
        println!("Failed to set autostart: {}", e);
    }
}

/// Read if autostart is currently enabled
pub fn get_autostart() -> bool {
    use winreg::RegKey;
    use winreg::enums::*;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
        return run_key.get_value::<String, _>("ActiveScreenTime").is_ok();
    }
    false
}

/// Check if Windows is in dark mode
pub fn is_system_dark_mode() -> bool {
    use winreg::RegKey;
    use winreg::enums::*;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(
        r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
    ) {
        if let Ok(val) = key.get_value::<u32, _>("AppsUseLightTheme") {
            return val == 0;
        }
    }
    false
}

/// Apply Mica backdrop effect (Windows 11 22H2+)
pub fn apply_mica_backdrop(hwnd: *mut std::ffi::c_void) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::*;

    let hwnd = HWND(hwnd as _);

    unsafe {
        // Enable Mica (DWMWCP_MICA = 2)
        let value: u32 = 2;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &value as *const u32 as *const _,
            std::mem::size_of::<u32>() as u32,
        );
    }
}
