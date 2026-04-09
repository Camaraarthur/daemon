// Phase 1 — extended tray menu.
//
// Layout:
//   ● daemon (status: connected / reconnecting / offline)
//   ─────────
//   New chat
//   Show window
//   ─────────
//   Pair new device...
//   Open settings
//   ─────────
//   Quit shell        (does NOT stop daemon-device.service)
//
// The status line is updated by ws_client when the worker connection
// state changes. The "Quit shell" item closes only the GUI shell —
// the headless worker (daemon-device.service or the sidecar process)
// keeps running, so the agent stays reachable from other devices.

use log::error;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconEvent,
    AppHandle, Manager,
};

pub struct TrayState {
    pub status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let tray = app
        .tray_by_id("daemon-tray")
        .ok_or("tray icon not configured in tauri.conf.json")?;

    let status = MenuItem::with_id(app, "status", "● connecting…", false, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, "new_chat", "New chat", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
    let pair = MenuItem::with_id(app, "pair", "Pair new device…", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Open settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit shell", true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &sep1,
            &new_chat,
            &show,
            &sep2,
            &pair,
            &settings,
            &sep3,
            &quit,
        ],
    )?;
    tray.set_menu(Some(menu))?;

    // Stash the status item handle so ws_client can update it later.
    let state = TrayState {
        status_item: Mutex::new(Some(status)),
    };
    app.manage(state);

    tray.on_menu_event(move |app, event| match event.id().as_ref() {
        "show" | "new_chat" => focus_main(app, None),
        "pair" => focus_main(app, Some("/settings/devices")),
        "settings" => focus_main(app, Some("/settings")),
        "quit" => {
            // GUI exit only — leave the worker running.
            std::process::exit(0);
        }
        _ => {}
    });

    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { .. } = event {
            focus_main(tray.app_handle(), None);
        }
    });

    Ok(())
}

fn focus_main(app: &AppHandle, navigate_to: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        if let Some(path) = navigate_to {
            // Navigate the existing webview rather than open a second window.
            let url = format!("https://my.daemon.page{}", path);
            if let Err(e) = window.eval(&format!("window.location.href = '{}'", url)) {
                error!("[tray] navigate eval failed: {}", e);
            }
        }
    }
}

/// Called by ws_client whenever the worker connection state changes.
/// Safe to call from any thread.
#[allow(dead_code)]
pub fn set_status(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(guard) = state.status_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(label);
            }
        }
    }
}
