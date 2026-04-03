use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // The tray icon is configured in tauri.conf.json and auto-created.
    // Here we set up the menu and click behavior.

    let tray = app.tray_by_id("daemon-tray");
    if let Some(tray) = tray {
        let show = MenuItem::with_id(app, "show", "Show daemon", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        tray.set_menu(Some(menu))?;

        tray.on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                std::process::exit(0);
            }
            _ => {}
        });

        tray.on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    }

    Ok(())
}
