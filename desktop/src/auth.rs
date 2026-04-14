// Auto-login via device_token exchange.
//
// The problem: opening https://my.daemon.page/chat inside a Tauri
// WebView2 hits a Google OAuth flow that Google blocks for embedded
// webviews. The user has no password (Google-only signup), so the
// login screen is a dead end.
//
// The fix: the Tauri app already has a device_token in
// ~/.daemon/config.json from pairing. POST it to
// /api/auth device_token_exchange → get a daemon_token session
// cookie → inject it into the webview BEFORE navigating to /chat.
// The webview loads /chat already authenticated. No Google needed,
// no password prompt.

use log::{error, info, warn};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
struct DeviceConfig {
    device_token: Option<String>,
    server_url: Option<String>,
    relay_url: Option<String>,
}

#[derive(Deserialize)]
struct ExchangeResponse {
    ok: bool,
    token: String,
    #[allow(dead_code)]
    daemon_name: String,
    #[allow(dead_code)]
    email: String,
}

fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".daemon").join("config.json"))
}

fn read_device_token() -> Option<String> {
    let path = config_path()?;
    let text = fs::read_to_string(path).ok()?;
    let cfg: DeviceConfig = serde_json::from_str(&text).ok()?;
    cfg.device_token.filter(|s| !s.is_empty())
}

fn relay_http_base() -> String {
    // Convert the device WS URL in config.json (wss://.../ws/device)
    // to the HTTPS base for /api calls. Default to my.daemon.page
    // if nothing configured.
    if let Some(path) = config_path() {
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<DeviceConfig>(&text) {
                let url = cfg.server_url.or(cfg.relay_url);
                if let Some(u) = url {
                    return u
                        .replace("wss://", "https://")
                        .replace("ws://", "http://")
                        .replace("/ws/device", "");
                }
            }
        }
    }
    "https://my.daemon.page".to_string()
}

/// Returns a daemon_token session string on success.
async fn exchange_device_token_for_session(device_token: &str) -> Result<String, String> {
    let url = format!("{}/api/auth", relay_http_base());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("reqwest client: {}", e))?;
    let body = serde_json::json!({ "action": "device_token_exchange" });
    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", device_token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("POST {}: {}", url, e))?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }
    let parsed: ExchangeResponse = res
        .json()
        .await
        .map_err(|e| format!("decode response: {}", e))?;
    if !parsed.ok {
        return Err("response not ok".to_string());
    }
    Ok(parsed.token)
}

/// Called from setup(). If the device is paired (device_token in
/// config.json), exchange for a session cookie and inject into the
/// webview before the chat URL is loaded. Non-blocking: runs in a
/// tokio task so setup() returns fast.
pub fn auto_login_if_paired(app: &AppHandle) {
    let device_token = match read_device_token() {
        Some(t) => t,
        None => {
            info!("[auth] no device_token in config.json — user will need to sign in manually");
            return;
        }
    };
    info!("[auth] device_token found, exchanging for session cookie…");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match exchange_device_token_for_session(&device_token).await {
            Ok(session_token) => {
                info!("[auth] session token received, injecting into webview");
                // Inject the daemon_token cookie via window.eval so the
                // webview's cookie jar has it before any fetch runs.
                // Belt-and-braces: also do a fresh reload so the chat
                // page picks up the new cookie and skips the login
                // screen.
                if let Some(window) = app_handle.get_webview_window("main") {
                    let script = format!(
                        "document.cookie = 'daemon_token={}; path=/; domain=.daemon.page; secure; samesite=lax; max-age=2592000'; if (window.location.pathname.startsWith('/login')) {{ window.location.href = '/chat'; }} else {{ window.location.reload(); }}",
                        session_token
                    );
                    if let Err(e) = window.eval(&script) {
                        error!("[auth] eval failed: {}", e);
                    }
                }
            }
            Err(e) => {
                warn!("[auth] device_token exchange failed: {}", e);
                warn!("[auth] user will see the normal login screen");
            }
        }
    });
}
