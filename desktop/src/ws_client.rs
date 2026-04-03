use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

use crate::commands;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRegistration {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub arch: String,
    pub capabilities: DeviceCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub shell: bool,
    pub files: bool,
    pub admin: bool,
    pub desktop: bool,
    pub git: bool,
}

#[derive(Clone, Serialize)]
struct WsStatusPayload {
    status: String,
}

/// Headless WS loop — runs without Tauri app handle, for service/SSH mode
pub async fn start_ws_loop_headless(server_url: String) {
    let connected = Arc::new(AtomicBool::new(false));
    let mut backoff_ms: u64 = 1000;

    loop {
        info!("Connecting to {}...", server_url);

        match connect_and_run_headless(&server_url, &connected).await {
            Ok(_) => info!("WebSocket closed normally"),
            Err(e) => error!("WebSocket error: {}", e),
        }

        connected.store(false, Ordering::SeqCst);

        let jitter = rand_u64() % (backoff_ms * 3 / 10 + 1);
        let delay = backoff_ms + jitter;
        warn!("Reconnecting in {}ms...", delay);
        sleep(Duration::from_millis(delay)).await;
        backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF.as_millis() as u64);
    }
}

pub fn start_ws_loop(app_handle: tauri::AppHandle, server_url: String) {
    let connected = Arc::new(AtomicBool::new(false));

    tokio::spawn(async move {
        let mut backoff_ms: u64 = 1000;

        loop {
            emit_status(&app_handle, "connecting");
            info!("Connecting to {}...", server_url);

            match connect_and_run(&app_handle, &server_url, &connected).await {
                Ok(_) => info!("WebSocket closed normally"),
                Err(e) => error!("WebSocket error: {}", e),
            }

            connected.store(false, Ordering::SeqCst);
            emit_status(&app_handle, "disconnected");

            let jitter = rand_u64() % (backoff_ms * 3 / 10 + 1);
            let delay = backoff_ms + jitter;
            warn!("Reconnecting in {}ms...", delay);
            sleep(Duration::from_millis(delay)).await;
            backoff_ms = (backoff_ms * 2).min(MAX_BACKOFF.as_millis() as u64);
        }
    });
}

async fn connect_and_run_headless(
    server_url: &str,
    connected: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    connect_and_run_inner(None, server_url, connected).await
}

async fn connect_and_run(
    app_handle: &tauri::AppHandle,
    server_url: &str,
    connected: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    connect_and_run_inner(Some(app_handle), server_url, connected).await
}

async fn connect_and_run_inner(
    app_handle: Option<&tauri::AppHandle>,
    server_url: &str,
    connected: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (ws_stream, _response) = connect_async(server_url).await?;
    let (mut write, mut read) = ws_stream.split();

    info!("Connected!");
    connected.store(true, Ordering::SeqCst);
    if let Some(ah) = app_handle {
        emit_status(ah, "connected");
    }

    // Send device registration
    let reg = build_registration();
    let reg_json = serde_json::to_string(&reg)?;
    write.send(Message::Text(reg_json)).await?;

    // Channel for sending messages back through the write half
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Spawn a task to forward outgoing messages
    let write_handle = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Heartbeat sender
    let hb_tx = tx.clone();
    let hb_connected = connected.clone();
    let heartbeat_handle = tokio::spawn(async move {
        let mut last_pong = Instant::now();
        loop {
            sleep(HEARTBEAT_INTERVAL).await;
            if !hb_connected.load(Ordering::SeqCst) {
                break;
            }
            if last_pong.elapsed() > HEARTBEAT_TIMEOUT {
                warn!("Heartbeat timeout");
                break;
            }
            let hb = serde_json::json!({
                "type": "heartbeat",
                "timestamp": chrono::Utc::now().timestamp_millis(),
            });
            if hb_tx.send(hb.to_string()).is_err() {
                break;
            }
            // Reset pong timer -- we'll get heartbeat_ack back
            last_pong = Instant::now();
        }
    });

    // Read incoming messages
    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                let last_pong_time = Instant::now();
                _ = last_pong_time; // heartbeat_ack resets in the heartbeat task

                match serde_json::from_str::<Value>(&text) {
                    Ok(msg) => {
                        let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match msg_type {
                            "heartbeat_ack" | "registered" => {
                                if msg_type == "registered" {
                                    if let Some(m) = msg.get("message").and_then(|v| v.as_str()) {
                                        info!("Registered: {}", m);
                                    }
                                }
                            }
                            _ => {
                                // Handle command
                                let tx_clone = tx.clone();
                                let msg_clone = msg.clone();
                                tokio::spawn(async move {
                                    if let Some(response) = handle_command(msg_clone).await {
                                        let _ = tx_clone.send(response.to_string());
                                    }
                                });
                            }
                        }
                    }
                    Err(e) => warn!("Failed to parse message: {}", e),
                }
            }
            Ok(Message::Close(_)) => {
                info!("Server sent close frame");
                break;
            }
            Ok(Message::Ping(_data)) => {
                // Tungstenite auto-responds to pings, no action needed
            }
            Err(e) => {
                error!("Read error: {}", e);
                break;
            }
            _ => {}
        }
    }

    connected.store(false, Ordering::SeqCst);
    heartbeat_handle.abort();
    write_handle.abort();

    Ok(())
}

async fn handle_command(msg: Value) -> Option<Value> {
    let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let request_id = msg
        .get("request_id")
        .and_then(|r| r.as_str())
        .unwrap_or("")
        .to_string();

    let result = match msg_type {
        "run_command" => {
            let cmd = msg.get("command").and_then(|c| c.as_str()).unwrap_or("");
            commands::run_shell_command(cmd).await
        }
        "get_device_info" => commands::get_device_info().await,
        "list_files" => {
            let path = msg
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let path = if path.is_empty() {
                dirs_home()
            } else {
                path
            };
            commands::list_files(&path).await
        }
        "read_file" => {
            let path = msg.get("path").and_then(|p| p.as_str()).unwrap_or("");
            commands::read_file(path).await
        }
        "receive_file" => {
            let filename = msg
                .get("filename")
                .and_then(|f| f.as_str())
                .unwrap_or("file");
            let data = msg.get("data").and_then(|d| d.as_str()).unwrap_or("");
            commands::receive_file(filename, data).await
        }
        "ping" => {
            serde_json::json!({ "status": "alive" })
        }
        _ => {
            serde_json::json!({ "error": format!("Unknown command: {}", msg_type) })
        }
    };

    Some(serde_json::json!({
        "type": "command_response",
        "request_id": request_id,
        "result": result,
    }))
}

fn build_registration() -> DeviceRegistration {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let platform = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let username = whoami::username();

    let has_git = std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok();

    DeviceRegistration {
        msg_type: "device_register".to_string(),
        device_id: format!("{}-{}-{}", hostname, platform, arch),
        device_name: format!("{}@{}", username, hostname),
        platform,
        arch,
        capabilities: DeviceCapabilities {
            shell: true,
            files: true,
            admin: is_admin(),
            desktop: true,
            git: has_git,
        },
    }
}

fn is_admin() -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::getuid() == 0 }
    }
    #[cfg(windows)]
    {
        false // Simplified -- could check via Windows API
    }
}

fn dirs_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

fn emit_status(app_handle: &tauri::AppHandle, status: &str) {
    let _ = app_handle.emit("ws-status", WsStatusPayload {
        status: status.to_string(),
    });
}

fn rand_u64() -> u64 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    RandomState::new().build_hasher().finish()
}
