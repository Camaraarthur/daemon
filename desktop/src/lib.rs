// Track A (fix-tauri-windows) — minimal, stable Tauri shell.
//
// Goal: a single-window WebView pointing at https://my.daemon.page/chat
// that launches via double-click on Windows/macOS/Linux, reads the
// device_token from ~/.daemon/config.json, and stays out of the way.
//
// Explicit non-goals for this branch:
//   - No global hotkey plugin (it fails in non-interactive sessions
//     and is a nice-to-have, not a ship-blocker)
//   - No notification plugin (same reason + no JSON config schema in
//     Tauri 2 → we add it later in Rust-only form with capabilities)
//   - No autostart plugin (same — also no JSON config schema)
//   - No clipboard/opener plugins (nice-to-have, not essential)
//   - No embedded Rust WS worker (superseded by cli/daemon.mjs)
//
// What stays:
//   - single_instance (MUST be first, per plugin docs)
//   - shell (for xdg-open / ShellExecuteW)
//   - tray icon (configured in tauri.conf.json, menu built in tray.rs)
//   - token_store module (reads ~/.daemon/config.json, keyring fallback)
//   - --test-headless flag so I can validate non-GUI paths via SSH
//     even though the GUI can't launch from a non-interactive session
//     (this is a fundamental Windows limitation, not a Tauri bug —
//     see docs/chat-client-strategy.md Track A root-cause analysis)

mod auth;
#[cfg(target_os = "macos")]
mod macos;
mod token_store;
mod tray;

use log::{error, info};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    info!("daemon-desktop v0.1.0 starting");

    // --test-headless exercises non-GUI code paths (token load, config
    // parse, keyring access) without attempting to create a window.
    // Use this flag when launching via SSH / scheduled task without
    // /it, since WebView2 requires an interactive window station.
    let headless = std::env::args().any(|a| a == "--test-headless");

    if headless {
        info!("Running in --test-headless mode");
        match token_store::load_shell_token() {
            Some(_) => info!("[token] shell_token loaded from secure storage"),
            None => info!("[token] no shell_token in keyring (fallback file also absent)"),
        }
        // Probe config.json existence and parse — surfaces config bugs
        // without needing a GUI.
        if let Some(home) = dirs::home_dir() {
            let cfg = home.join(".daemon").join("config.json");
            if cfg.exists() {
                match std::fs::read_to_string(&cfg) {
                    Ok(text) => {
                        let has_tok = text.contains("\"device_token\"");
                        info!(
                            "[config] {} ({} bytes, device_token: {})",
                            cfg.display(),
                            text.len(),
                            if has_tok { "present" } else { "missing" },
                        );
                    }
                    Err(e) => error!("[config] read failed: {}", e),
                }
            } else {
                info!("[config] {} not found — pair via my.daemon.page first", cfg.display());
            }
        }
        info!("--test-headless completed. Exiting.");
        return;
    }

    info!("Launching GUI (main window → https://my.daemon.page/chat)");

    let builder_result = tauri::Builder::default()
        // single_instance MUST be the FIRST plugin — Tauri's own docs.
        // Second launch focuses the existing window instead of opening
        // a second daemon.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // shell plugin — for tauri_plugin_shell::ShellExt::open() to
        // open URLs / files with the OS default app.
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // macOS: set accessory activation policy (menu-bar only,
            // no Dock icon) + TCC prompt for notifications.
            #[cfg(target_os = "macos")]
            {
                macos::set_accessory_activation_policy();
                macos::probe_notification_authorization();
            }

            // Load the shell_token from keyring INSIDE setup. On
            // Windows, calling keyring before Builder::default() can
            // block in non-interactive sessions (Credential Manager
            // hang). Keeping it here means the main thread has
            // already established a window station by the time we
            // touch Credential Manager.
            match token_store::load_shell_token() {
                Some(_) => info!("[token] shell_token loaded from secure storage"),
                None => info!("[token] no shell_token yet — chat will pair via web UI"),
            }

            // Build the tray menu. If this fails we log and continue —
            // the main window still works without the tray.
            if let Err(e) = tray::setup_tray(&handle) {
                error!("[tray] setup failed: {}", e);
            }

            // Auto-login: exchange device_token (from ~/.daemon/config.json,
            // written at pairing) for a daemon_token session cookie.
            // Injects the cookie into the webview before /chat loads, so
            // the user never sees a login screen. Non-blocking.
            auth::auto_login_if_paired(&handle);

            // Explicitly show the main window in case the conf.json
            // visible:true wasn't honored (belt and braces — some
            // Linux compositors swallow the initial show).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    match builder_result {
        Ok(_) => info!("GUI exited normally"),
        Err(e) => {
            error!("GUI failed to initialize: {}", e);
            error!("If you're launching via SSH, use a scheduled task with /it flag — WebView2 requires an interactive window station.");
            std::process::exit(1);
        }
    }
}
