// Phase 1 — secure storage for the daemon shell's tokens.
//
// Two distinct token types per the OS-research synthesis:
//
//   device_token  → the worker's authentication for /ws/device.
//                   Already managed by cli/daemon.mjs in
//                   ~/.daemon/config.json. The shell does NOT
//                   touch this file; the worker owns it.
//
//   shell_token   → the chat-UI's authentication for /ws/client
//                   and /api/* HTTP routes. Distinct scope on the
//                   relay. Stored here.
//
// Storage backends (via the `keyring` crate, single API):
//   Linux:   Secret Service (libsecret / GNOME Keyring / KWallet)
//   macOS:   Keychain Services (Security.framework)
//   Windows: Credential Manager (CredWriteW/CredReadW)
//
// Fallback when Secret Service is unavailable (headless server, no
// gnome-keyring): write to ~/.daemon/shell-token, chmod 600. The
// fallback is a last resort and is logged loudly so the operator
// knows.

use keyring::Entry;
use log::{info, warn};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const SERVICE: &str = "page.daemon.desktop";
const ACCOUNT: &str = "shell_token";

fn fallback_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".daemon").join("shell-token"))
}

pub fn save_shell_token(token: &str) -> Result<(), String> {
    match Entry::new(SERVICE, ACCOUNT) {
        Ok(entry) => match entry.set_password(token) {
            Ok(()) => {
                info!("[token] saved shell_token to keyring");
                Ok(())
            }
            Err(e) => {
                warn!("[token] keyring set failed ({}), falling back to file", e);
                save_to_file(token)
            }
        },
        Err(e) => {
            warn!("[token] keyring open failed ({}), falling back to file", e);
            save_to_file(token)
        }
    }
}

pub fn load_shell_token() -> Option<String> {
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        if let Ok(secret) = entry.get_password() {
            return Some(secret);
        }
    }
    load_from_file()
}

#[allow(dead_code)]
pub fn delete_shell_token() -> Result<(), String> {
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_credential();
    }
    if let Some(path) = fallback_path() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn save_to_file(token: &str) -> Result<(), String> {
    let path = fallback_path().ok_or("no home dir")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(token.as_bytes()).map_err(|e| e.to_string())?;
    drop(f);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    info!("[token] saved shell_token to {}", path.display());
    Ok(())
}

fn load_from_file() -> Option<String> {
    let path = fallback_path()?;
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}
