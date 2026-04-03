use base64::Engine;
use log::warn;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use sysinfo::System;
use tokio::process::Command;

/// Run a shell command. Uses PowerShell on Windows, bash/sh on Unix.
pub async fn run_shell_command(command: &str) -> Value {
    let (program, args) = if cfg!(target_os = "windows") {
        ("powershell", vec!["-NoProfile", "-Command", command])
    } else {
        ("sh", vec!["-c", command])
    };

    match tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(program).args(&args).output(),
    )
    .await
    {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            json!({
                "stdout": truncate(&stdout, 10000),
                "stderr": truncate(&stderr, 5000),
                "exit_code": output.status.code().unwrap_or(-1),
            })
        }
        Ok(Err(e)) => json!({ "error": format!("Failed to execute: {}", e) }),
        Err(_) => json!({ "error": "Command timed out (30s)" }),
    }
}

/// Get device info matching the Node.js CLI output format.
pub async fn get_device_info() -> Value {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let username = whoami::username();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    json!({
        "hostname": hostname,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpus": sys.cpus().len(),
        "total_memory_gb": round1(sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0),
        "free_memory_gb": round1(sys.available_memory() as f64 / 1024.0 / 1024.0 / 1024.0),
        "user": username,
        "home": home,
        "runtime": "tauri/rust",
        "uptime_hours": round1(System::uptime() as f64 / 3600.0),
    })
}

/// List files in a directory (max 200 entries).
pub async fn list_files(path: &str) -> Value {
    let dir = Path::new(path);
    match tokio::fs::read_dir(dir).await {
        Ok(mut entries) => {
            let mut files = Vec::new();
            let mut count = 0;
            while let Ok(Some(entry)) = entries.next_entry().await {
                if count >= 200 {
                    break;
                }
                let is_dir = entry
                    .file_type()
                    .await
                    .map(|ft| ft.is_dir())
                    .unwrap_or(false);
                files.push(json!({
                    "name": entry.file_name().to_string_lossy(),
                    "is_dir": is_dir,
                }));
                count += 1;
            }
            let len = files.len();
            json!({ "path": path, "files": files, "count": len })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

/// Read a file's content (max 1MB).
pub async fn read_file(path: &str) -> Value {
    let p = Path::new(path);
    match tokio::fs::metadata(p).await {
        Ok(meta) => {
            if meta.len() > 1_000_000 {
                return json!({ "error": "File too large (>1MB)", "size": meta.len() });
            }
            match tokio::fs::read_to_string(p).await {
                Ok(content) => json!({ "path": path, "content": content, "size": meta.len() }),
                Err(e) => json!({ "error": e.to_string() }),
            }
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

/// Receive a base64-encoded file and save to Downloads.
pub async fn receive_file(filename: &str, data: &str) -> Value {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/tmp".to_string());
    let downloads = Path::new(&home).join("Downloads");

    if let Err(e) = tokio::fs::create_dir_all(&downloads).await {
        return json!({ "error": format!("Cannot create Downloads dir: {}", e) });
    }

    let filepath = downloads.join(filename);
    match base64::engine::general_purpose::STANDARD.decode(data) {
        Ok(bytes) => match tokio::fs::write(&filepath, &bytes).await {
            Ok(_) => json!({
                "saved": true,
                "filename": filename,
                "size": bytes.len(),
                "path": filepath.to_string_lossy(),
            }),
            Err(e) => json!({ "error": e.to_string() }),
        },
        Err(e) => {
            warn!("Base64 decode failed: {}", e);
            json!({ "error": format!("Base64 decode failed: {}", e) })
        }
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() > max {
        &s[..max]
    } else {
        s
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}
