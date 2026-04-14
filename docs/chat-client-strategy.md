# Daemon Chat Client — Strategy (synthesized from 4 parallel research agents, 2026-04-14)

Two parallel tracks:

- **Branch `fix-tauri-windows`** — unblock the existing Tauri app so MSI has a working chat window today. 2-4 hours of surgical fixes. Ship stopgap.
- **Branch `native-rust-chat`** — fork Icebreaker, build a pure-native Rust desktop chat client with iced 0.14, no webview, no Electron, single ~12 MB binary. Real answer. 2-3 weeks.

Both test end-to-end on MSI continuously via `schtasks /create /it` (interactive flag — bypasses the SSH non-interactive-session trap).

---

## Track A — `fix-tauri-windows`

### What's actually broken (agent 1 diagnosis)

Four plugin errors in the current build (`autostart`, `notification`, `global-shortcut`, `clipboard-manager`, `opener`) all have the **same root cause**: in Tauri 2 these plugins have NO JSON config schema — configured in Rust only. Permissions live in `src-tauri/capabilities/default.json`. The JSON map `{args: []}` or `{all: true}` that commit `8741e6c` added fails to deserialize as unit type → Builder init aborts → window never creates.

WebView2 HRESULT `0x80070578` and hotkey OS error `1459` have a different root cause: **SSH-launched `Start-Process` runs in session 0 / non-interactive window station.** Cannot be fixed by config — it's Windows platform behavior. For remote test we use `schtasks /create /it` (interactive flag).

### Patches (apply in order)

1. **`desktop/tauri.conf.json`**: strip invalid plugins, keep only `shell: {open: true}`. Add `bundle.windows.webviewInstallMode: {type: "embedBootstrapper"}` for WebView2-missing case. Keep `frontendDist: "frontend"` (correct — bundler embeds).
2. **`desktop/src-tauri/capabilities/default.json`** (new): permission identifiers for `notification:default`, `global-shortcut:default`, `clipboard-manager:default`, `opener:default`, `autostart:default`.
3. **`desktop/Cargo.toml`**: pin `tauri = "2.1"`, all plugins to a coherent tagged version. `cargo update` + commit lockfile.
4. **`desktop/src/lib.rs`** init order:
   - `env_logger` first
   - `tauri::Builder::default()` with `single_instance` as the **FIRST** plugin
   - Remaining plugins in dependency order
   - Move WS spawn INSIDE `.setup(|app| {...})` — delete the pre-empting background thread
   - Move `token_store::load_shell_token()` inside setup (keyring on Windows can hang in non-interactive)
5. **`desktop/src/tray.rs`**: add explicit `tray.set_show_menu_on_left_click(false)` so right-click is the menu trigger. Verify menu is attached BEFORE the icon appears.
6. **Add `--test-headless` flag**: skip `Builder::default().run()` and exercise only WS + token paths. Lets me validate non-GUI code via SSH even though GUI can't test that way.

### MSI testing

```powershell
schtasks /create /tn DaemonTauriTest `
  /tr "C:\Users\tutuc\daemon-desktop.exe" `
  /sc once /st 00:00 /rl HIGHEST /it /f
schtasks /run /tn DaemonTauriTest
# /it = interactive, runs in user's desktop session (has window station)
```

### Reference implementation

**Rocket.Chat Desktop Tauri port** (github.com/RocketChat/Tauri.Desktop.App) — production chat, Tauri 2, Windows MSI shipping. Compare our `tauri.conf.json`, `Cargo.toml`, `lib.rs` init order line-by-line.

Secondary: `github.com/tauri-apps/plugins-workspace/examples/` — each plugin has canonical init.

---

## Track B — `native-rust-chat`

### The decision: fork Icebreaker

Of everything the agents surveyed, **one project wins**: `github.com/hecrj/icebreaker`.

- Authored by **Héctor Ramón, iced's maintainer** — patterns are canonical
- MIT licensed (no GPL contamination, unlike Halloy / Fractal / Paper Plane)
- Active: 2026.2 release Feb 2026, 161 commits, 425 stars
- **Already implements streaming chat in iced** with proper token append + markdown rendering
- 100% Rust native, no webview, no WebView2 dependency
- Font/asset pipeline, cross-platform build already set up

We rip out:
- `src/model/*.rs` (llama.cpp local-model backend)
- Hugging Face search screen (`src/screen/search.rs`)
- In-memory session store

We add:
- `crates/relay-client/` — WSS transport (`tokio-tungstenite`), HTTP client (`reqwest` + `rustls`), SSE parser for streaming chat
- `crates/cache/` — SQLite layer using `rusqlite` (bundled = no libsqlite3 dep)
  - schema: `messages(id TEXT PK, client_txn_id TEXT UNIQUE, server_id, thread_id, role, content, model, created_at, status)`
  - send queue: `outbound(id, client_txn_id, body, retries, last_error, status)`
  - UI reads ONLY from SQLite, never from network directly
- Thread list screen (left sidebar, Telegram-style)
- Settings screen (devices, secrets, schedules panels — thin views over relay endpoints)
- Tray icon via `tray-icon` crate (bypasses Tauri's broken v2 tray — direct `Shell_NotifyIconW` on Windows)
- OS notifications via `notify-rust` (libnotify / NSUserNotificationCenter / WinRT toast)
- Global hotkey via `global-hotkey` crate
- Auto-start: Windows `HKCU\...\Run` registry write, macOS `SMAppService`, Linux `.desktop` in `~/.config/autostart/`
- Keyring-backed `device_token` + `shell_token` (distinct scopes) via `keyring` crate

### Architecture: two-process + watchdog (Tailscale pattern)

```
daemon-monitor (50 KB)
    ├─ spawns daemond (Windows Service / LaunchAgent / systemd --user)
    │     ├─ owns /ws/device connection
    │     ├─ exposes 9 device tools + memory + secrets + scheduler
    │     └─ crashes → monitor restarts with exp backoff (1s → 60s cap)
    └─ spawns daemon-gui (iced chat app)
          ├─ WS to /ws/client (push events)
          ├─ HTTP to /api/chat (streaming SSE)
          ├─ SQLite cache at ~/.daemon/cache.sqlite (offline reads + outbound queue)
          └─ crashes → monitor restarts
```

On Windows: `daemond` is a **real Service** with `SC_ACTION_RESTART` set to 1s/5s/30s via `ChangeServiceConfig2` (Tailscale pattern). `daemon-gui` autostarts via `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

### 12 MB binary budget

```
iced 0.14 + wgpu + cosmic-text:  4.5 MB
rusqlite (bundled):              1.2 MB
syntect + default syntaxes:      2.0 MB
tokio + reqwest + rustls +
  tokio-tungstenite:             1.8 MB
Inter + JetBrains Mono
  (WOFF2 subset):                0.8 MB
resvg icons:                     0.2 MB
SQL migrations (include_str!):   0.05 MB
app logic:                      ~1.5 MB
                                ──────
Total:                          ~12 MB
```

Embed everything via `include_bytes!` / `rust-embed`. `cargo build --release && strip` (no UPX on macOS — breaks codesign).

### Cold start <500ms

1. Embed Inter font via `include_bytes!` — zero disk I/O at launch
2. Memory-map `~/.daemon/cache.sqlite` at startup
3. Render last 20 messages from WAL → paint window
4. Open WebSocket AFTER first paint
5. Defer embedding/semantic-search until first input
6. Windows: `/DELAYLOAD:ws2_32.dll,crypt32.dll` via `cargo-packager`

### Offline-first (Signal Desktop pattern)

- UI reads only from SQLite, always. Network is source of truth but never on the hot path.
- Every outbound message gets a `client_txn_id` (UUID), persisted to `outbound` table, sent, retried on reconnect. Relay dedupes by `client_txn_id`.
- Status bar: single `ConnectionState` atom — `Connected | Reconnecting | Offline`. No per-component nagging.
- Reconnect: exponential backoff from matrix-rust-sdk's `SendQueue` (reference at `crates/matrix-sdk/src/send_queue.rs`).

### Tray done right

**Skip Tauri's tray entirely.** Use `tray-icon` crate standalone:
- Windows: direct `Shell_NotifyIconW` + `TrackPopupMenu` on `WM_RBUTTONUP`. Register **AUMID** `page.daemon.Desktop` in installer (critical — without it toast clicks don't route back to our app).
- macOS: `NSStatusItem` with `length: NSSquareStatusItemLength` (avoids variable-width flicker).
- Linux: `ksni` crate → StatusNotifierItem (modern, replaces dead XEmbed).

### Auto-update

- `cargo-packager` for build output (successor to `cargo-bundle`, Tauri team's tool)
- Mac: Sparkle 2 (bundled framework, EdDSA-signed appcast)
- Windows: NSIS installer + Squirrel.Windows for delta patches
- Linux: AppImage + `self_update` crate, or deb via apt repo
- `daemon-monitor` checks appcast every 6h, swaps binary on next restart, user sees nothing

### MSI testing cadence

Every 30 minutes of work → push to MSI → `schtasks /it` run → screenshot → iterate. Agent 3's pattern: status bar is the source of truth for debugging; we log `ConnectionState` transitions to `~/.daemon/gui.log` for remote tail.

---

## Timeline

| Week | Track A (fix-tauri) | Track B (native-rust) |
|---|---|---|
| Today (~4h) | All 6 patches applied + MSI verified via schtasks /it | Fork Icebreaker, build from source on MSI to confirm toolchain, commit scaffold |
| Week 1 | — (shipped as stopgap) | Strip llama, add relay-client crate, connect to wss://my.daemon.page |
| Week 2 | — | Thread list, SQLite cache, streaming SSE, tray via `tray-icon` |
| Week 3 | — | Windows Service daemond, monitor watchdog, auto-pair from config.json, notarize/sign installers |
| Week 4 | — | Beta on MSI + arturito + one external user |

**Branch policy:** `fix-tauri-windows` ships as `daemon-desktop-tauri.exe` at `my.daemon.page/daemon-desktop.exe` for anyone who installed the current version. `native-rust-chat` ships as a distinct `daemon.exe` / `Daemon.app` / `daemon_*.AppImage` once ready. Old Tauri retires when native reaches parity.

---

## References

- Tauri plugin schema bug: [tauri#8769](https://github.com/tauri-apps/tauri/issues/8769), [tauri#9231](https://github.com/tauri-apps/tauri/issues/9231)
- SSH session 0: [tauri discussion #6008](https://github.com/tauri-apps/tauri/discussions/6008)
- Fork target: [hecrj/icebreaker](https://github.com/hecrj/icebreaker)
- Reference implementations: [squidowl/halloy](https://github.com/squidowl/halloy), [project-robius/robrix](https://github.com/project-robius/robrix), [Telegram Desktop](https://github.com/telegramdesktop/tdesktop), [syncthing](https://github.com/syncthing/syncthing/tree/main/cmd/syncthing), [tailscale](https://github.com/tailscale/tailscale)
- Framework: [iced 0.14](https://github.com/iced-rs/iced), [longbridge/gpui-component](https://github.com/longbridge/gpui-component) (dark horse)
- Crates: `tray-icon`, `notify-rust`, `global-hotkey`, `keyring`, `rusqlite` (bundled), `cargo-packager`
