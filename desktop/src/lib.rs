// Phase 1 — Linux desktop chat shell.
//
// The shell is the GUI half of daemon on Linux. It hosts a WebView
// pointed at https://my.daemon.page/chat plus tray, hotkey, native
// notifications, single-instance, autostart, and secure token
// storage. The headless WORKER is a separate process — either the
// production daemon-device.service or, on a fresh install where
// systemd is not available, a sidecar spawned from cli/daemon.mjs.
//
// The Rust ws_client.rs path remains for backward compatibility but
// is being de-emphasized: in v1.1 it becomes status-only, and the
// canonical worker is the Node sidecar. For v1, we run both in
// parallel (the embedded worker connects to /ws/device with its own
// device id, the chat UI connects to /ws/client with the shell
// token, and the user gets two device rows in the registry — one
// for the systemd worker, one for the embedded one). The shell side
// of this is what's new.

mod commands;
mod hotkey;
#[cfg(target_os = "macos")]
mod macos;
mod token_store;
mod tray;
mod ws_client;

use log::{error, info, warn};
use tauri::Manager;

const DEFAULT_SERVER: &str = "wss://my.daemon.page/ws/device";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    let server_url = std::env::var("DAEMON_SERVER").unwrap_or_else(|_| DEFAULT_SERVER.to_string());

    info!("daemon desktop v0.1.0");
    info!("Server: {}", server_url);

    if token_store::load_shell_token().is_some() {
        info!("[token] shell_token loaded from secure storage");
    } else {
        info!("[token] no shell_token yet — first launch will pair via /settings/devices");
    }

    let headless = std::env::args().any(|a| a == "--headless" || a == "--service");

    if headless {
        info!("Running in headless mode (no GUI)");
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime");
        rt.block_on(async {
            ws_client::start_ws_loop_headless(server_url).await;
        });
        return;
    }

    // Start WS in background thread with its own runtime. (v1.1 will
    // delete this and rely entirely on the cli/daemon.mjs sidecar.)
    let url = server_url.clone();
    let ws_thread = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime");
        rt.block_on(async {
            ws_client::start_ws_loop_headless(url).await;
        });
    });

    let gui_result = tauri::Builder::default()
        // ── Single-instance: second launch focuses existing window
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // ── Autostart: ~/.config/autostart/daemon-shell.desktop on Linux
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // ── Native notifications via libnotify / NSUNC / WinRT toasts
        .plugin(tauri_plugin_notification::init())
        // ── Clipboard read/write for the share-to-daemon path
        .plugin(tauri_plugin_clipboard_manager::init())
        // ── Open files / URLs with the OS default app
        .plugin(tauri_plugin_opener::init())
        // ── Global hotkey (Ctrl+Alt+Space)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // ── Existing shell plugin for spawning sidecars
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let handle = app.handle().clone();

            // macOS: hide Dock icon (menu-bar resident), probe TCC
            // for Notification authorization at a sensible moment.
            #[cfg(target_os = "macos")]
            {
                macos::set_accessory_activation_policy();
                macos::probe_notification_authorization();
            }

            if let Err(e) = tray::setup_tray(&handle) {
                error!("Failed to setup tray: {}", e);
            }

            if let Err(e) = hotkey::register(&handle) {
                warn!("Hotkey registration failed: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    match gui_result {
        Ok(_) => info!("GUI exited normally"),
        Err(e) => {
            error!("GUI failed: {} — running headless", e);
            let _ = ws_thread.join();
        }
    }
}
