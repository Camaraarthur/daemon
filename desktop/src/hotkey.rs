// Phase 1 — global hotkey to summon the daemon chat window from
// anywhere on the desktop.
//
// Default binding: Ctrl+Alt+Space (NOT Super+Space — Super+Space is
// taken by GNOME's input source switch and KDE's KRunner). Users can
// rebind via the relay's settings page once that ships.
//
// On registration failure (most commonly: another app already has
// the same hotkey), we log a warning and keep going. The tray menu
// is the always-available fallback.

use log::{info, warn};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn default_hotkey() -> Shortcut {
    Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT),
        Code::Space,
    )
}

pub fn register(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let hotkey = default_hotkey();
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(hotkey, move |_app, _shortcut, event| {
            // Only fire on key DOWN (otherwise we toggle twice per press).
            if event.state() != ShortcutState::Pressed {
                return;
            }
            toggle_main_window(&app_clone);
        })?;

    match app.global_shortcut().register(hotkey) {
        Ok(()) => info!("[hotkey] Ctrl+Alt+Space registered"),
        Err(e) => warn!(
            "[hotkey] failed to register Ctrl+Alt+Space: {} — use the tray icon",
            e
        ),
    }
    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }
}
