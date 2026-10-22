//! GitHub Releases based Auto-Updater for Active Screen Time.
//! Fetches release metadata from https://github.com/Fluntyy/ActiveScreenTime.
//! Completely privacy-focused: only makes network requests when auto_check_updates is enabled or when manually requested.

use tauri::{AppHandle, Emitter};

pub const GITHUB_REPO: &str = "Fluntyy/ActiveScreenTime";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub changelog: String,
    pub release_url: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub asset_size: Option<u64>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadProgress {
    pub percent: f64,
    pub downloaded: u64,
    pub total: u64,
}

/// Compares version strings like "0.1.1" vs "v0.1.2".
/// Returns true if remote is strictly newer than current.
pub fn is_newer_version(current: &str, remote: &str) -> bool {
    let clean_curr = current.trim().trim_start_matches(|c| c == 'v' || c == 'V');
    let clean_remote = remote.trim().trim_start_matches(|c| c == 'v' || c == 'V');

    let curr_parts: Vec<u64> = clean_curr.split('.').filter_map(|p| p.parse().ok()).collect();
    let remote_parts: Vec<u64> = clean_remote.split('.').filter_map(|p| p.parse().ok()).collect();

    let max_len = std::cmp::max(curr_parts.len(), remote_parts.len());
    for i in 0..max_len {
        let c = curr_parts.get(i).copied().unwrap_or(0);
        let r = remote_parts.get(i).copied().unwrap_or(0);
        if r > c {
            return true;
        } else if r < c {
            return false;
        }
    }
    false
}

/// Fetch latest release from GitHub API.
pub fn fetch_latest_release(current_ver: &str) -> Result<Option<UpdateInfo>, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);

    let resp = ureq::get(&url)
        .set("User-Agent", "ActiveScreenTime-Updater")
        .set("Accept", "application/vnd.github.v3+json")
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("Failed to reach GitHub: {}", e))?;

    let json: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("Failed to parse release response: {}", e))?;

    let tag = json["tag_name"].as_str().unwrap_or("").to_string();
    if tag.is_empty() {
        return Ok(None);
    }

    if !is_newer_version(current_ver, &tag) {
        return Ok(None);
    }

    let release_name = json["name"].as_str().unwrap_or(&tag).to_string();
    let changelog = json["body"].as_str().unwrap_or("No changelog provided.").to_string();
    let release_url = json["html_url"].as_str().unwrap_or("").to_string();

    let mut asset_name = None;
    let mut asset_url = None;
    let mut asset_size = None;

    if let Some(assets) = json["assets"].as_array() {
        // Priority 1: Windows installer (.exe)
        for a in assets {
            let name = a["name"].as_str().unwrap_or("").to_string();
            let lower = name.to_lowercase();
            if lower.ends_with(".exe") {
                asset_name = Some(name);
                asset_url = a["browser_download_url"].as_str().map(|s| s.to_string());
                asset_size = a["size"].as_u64();
                break;
            }
        }

        // Priority 2: MSI installer (.msi) if no .exe was found
        if asset_name.is_none() {
            for a in assets {
                let name = a["name"].as_str().unwrap_or("").to_string();
                let lower = name.to_lowercase();
                if lower.ends_with(".msi") {
                    asset_name = Some(name);
                    asset_url = a["browser_download_url"].as_str().map(|s| s.to_string());
                    asset_size = a["size"].as_u64();
                    break;
                }
            }
        }
    }

    Ok(Some(UpdateInfo {
        current_version: current_ver.to_string(),
        latest_version: tag,
        release_name,
        changelog,
        release_url,
        asset_name,
        asset_url,
        asset_size,
    }))
}

/// Download installer file streaming progress events, then launch it and exit.
pub fn download_and_install_update(
    app: &AppHandle,
    asset_url: &str,
    asset_name: &str,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(asset_name);

    let resp = ureq::get(asset_url)
        .set("User-Agent", "ActiveScreenTime-Updater")
        .timeout(std::time::Duration::from_secs(300))
        .call()
        .map_err(|e| format!("Download request failed: {}", e))?;

    let total_bytes = resp
        .header("Content-Length")
        .and_then(|h| h.parse::<u64>().ok())
        .unwrap_or(0);

    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create temporary file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 65536]; // 64KB chunks

    loop {
        use std::io::Read;
        let bytes_read = reader
            .read(&mut buf)
            .map_err(|e| format!("Download transfer error: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        use std::io::Write;
        file.write_all(&buf[..bytes_read])
            .map_err(|e| format!("Failed writing file to disk: {}", e))?;

        downloaded += bytes_read as u64;

        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };

        let _ = app.emit("update-download-progress", DownloadProgress {
            percent,
            downloaded,
            total: total_bytes,
        });
    }

    drop(file);

    // Launch installer
    let _ = std::process::Command::new(&file_path)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    // Signal app to quit so the installer can update files
    crate::IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(is_newer_version("0.1.1", "0.1.2"));
        assert!(is_newer_version("0.1.1", "v0.1.2"));
        assert!(is_newer_version("0.1.1", "v0.2.0"));
        assert!(is_newer_version("0.1.1", "1.0.0"));
        assert!(is_newer_version("0.1.1", "0.1.1.1"));

        assert!(!is_newer_version("0.1.1", "0.1.1"));
        assert!(!is_newer_version("0.1.1", "v0.1.1"));
        assert!(!is_newer_version("0.1.1", "0.1.0"));
        assert!(!is_newer_version("0.1.1", "v0.1.0"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));
    }
}
