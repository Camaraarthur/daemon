mod commands;
mod tray;
mod ws_client;

use log::{info, error};

const DEFAULT_SERVER: &str = "wss://my.daemon.page/ws/device";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    let server_url = std::env::var("DAEMON_SERVER")
        .unwrap_or_else(|_| DEFAULT_SERVER.to_string());

    info!("daemon desktop v0.1.0");
    info!("Server: {}", server_url);

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
    } else {
        // Start WS in background thread with its own runtime
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

        // Try Tauri GUI — if it fails (no display, no WebView2), fall back to headless
        let gui_result = tauri::Builder::default()
            .plugin(tauri_plugin_shell::init())
            .setup(move |app| {
                let handle = app.handle().clone();
                if let Err(e) = tray::setup_tray(&handle) {
                    error!("Failed to setup tray: {}", e);
                }
                Ok(())
            })
            .run(tauri::generate_context!());

        match gui_result {
            Ok(_) => info!("GUI exited normally"),
            Err(e) => {
                error!("GUI failed: {} — running headless", e);
                // WS thread is already running, just wait for it
                let _ = ws_thread.join();
            }
        }
    }
}
