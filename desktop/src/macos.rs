// Phase 4 — macOS-specific shell glue.
//
// Three responsibilities:
//
//   1. Set the activation policy to .accessory at launch so the
//      app does NOT show in the Dock — it's a menu-bar resident
//      with a tray icon, not a windowed app.
//
//   2. Install/uninstall the LaunchAgent that runs the worker
//      (`node cli/daemon.mjs`) at user login. LaunchAgent (NOT
//      LaunchDaemon — LaunchAgent runs as the user, has GUI/
//      Keychain access, and matches the Linux systemd-user model
//      and the Windows HKCU Run key model exactly).
//
//   3. First-run Accessibility / Notification permission probe
//      so the user gets the TCC prompt at the right moment, not
//      mysteriously the first time they press the global hotkey.
//
// All Apple framework calls go through objc2. We do NOT bundle a
// Swift sidecar in v1 — every macOS-specific bit is reachable from
// Rust via objc2. Swift sidecar is a v1.5 polish item for App
// Intents on Sonoma+.

#![cfg(target_os = "macos")]

use log::{info, warn};
use std::fs;
use std::path::PathBuf;

const LAUNCH_AGENT_LABEL: &str = "page.daemon.worker";

/// Hide the Dock icon — we're a menu-bar app.
pub fn set_accessory_activation_policy() {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    unsafe {
        let cls = AnyClass::get(c"NSApplication").expect("NSApplication");
        let app: *mut objc2::runtime::AnyObject = msg_send![cls, sharedApplication];
        // NSApplicationActivationPolicyAccessory = 1
        let _: () = msg_send![app, setActivationPolicy: 1i64];
    }
}

/// Install the LaunchAgent plist that runs `node cli/daemon.mjs` on
/// login. Idempotent.
pub fn install_launch_agent(node_path: &str, daemon_mjs_path: &str) -> Result<(), String> {
    let target = launch_agent_path()?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let plist = render_launch_agent_plist(node_path, daemon_mjs_path);
    fs::write(&target, plist).map_err(|e| e.to_string())?;
    info!("[macos] LaunchAgent installed at {}", target.display());

    // launchctl bootstrap into the user's session so it starts now.
    let uid = unsafe { libc::getuid() };
    let _ = std::process::Command::new("launchctl")
        .args([
            "bootstrap",
            &format!("gui/{}", uid),
            target.to_str().unwrap_or_default(),
        ])
        .output();
    Ok(())
}

#[allow(dead_code)]
pub fn uninstall_launch_agent() -> Result<(), String> {
    let target = launch_agent_path()?;
    let uid = unsafe { libc::getuid() };
    let _ = std::process::Command::new("launchctl")
        .args([
            "bootout",
            &format!("gui/{}/{}", uid, LAUNCH_AGENT_LABEL),
        ])
        .output();
    if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
        info!("[macos] LaunchAgent removed from {}", target.display());
    }
    Ok(())
}

fn launch_agent_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("no home dir")?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{}.plist", LAUNCH_AGENT_LABEL)))
}

fn render_launch_agent_plist(node_path: &str, daemon_mjs_path: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{node}</string>
        <string>{daemon}</string>
        <string>--no-update</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>NetworkState</key>
        <true/>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/daemon-worker.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/daemon-worker.log</string>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
"#,
        label = LAUNCH_AGENT_LABEL,
        node = node_path,
        daemon = daemon_mjs_path,
    )
}

/// Probe Notification authorization so the system prompt comes up
/// at a sensible moment instead of the first time the agent fires
/// notify(). Best-effort; the user can grant later in System Settings.
pub fn probe_notification_authorization() {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    unsafe {
        let cls = match AnyClass::get(c"UNUserNotificationCenter") {
            Some(c) => c,
            None => {
                warn!("[macos] UNUserNotificationCenter unavailable");
                return;
            }
        };
        let center: *mut objc2::runtime::AnyObject = msg_send![cls, currentNotificationCenter];
        // UNAuthorizationOptionAlert (1<<0) | Sound (1<<1) | Badge (1<<2) = 7
        let options: u64 = 7;
        // We pass a null completion handler — best-effort, we don't need the result.
        let _: () = msg_send![center, requestAuthorizationWithOptions: options completionHandler: std::ptr::null::<()>()];
    }
}
