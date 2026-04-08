# Daemon iOS

Swift native iOS app for daemon. Thin client to `my.daemon.page`. The
brain runs on the user's laptop, daemon-key, or server — the iPhone is
just a face.

- iOS 17+ (required for App Intents, Live Activities)
- Swift 5.9+
- Zero third-party dependencies
- XcodeGen-managed project — no `.xcodeproj` committed

## What's in here

```
ios/Daemon/
├── project.yml                    # XcodeGen spec, materialize with `xcodegen`
├── SupportingFiles/
│   ├── Info.plist
│   ├── Daemon.entitlements        # APNs + App Groups
│   ├── NotificationServiceExtension-Info.plist
│   └── NotificationServiceExtension.entitlements
├── Sources/
│   ├── Daemon/
│   │   ├── DaemonApp.swift              # @main, AppDelegate, silent-push drain
│   │   ├── ContentView.swift            # SwiftUI chat UI
│   │   ├── DaemonClient.swift           # HTTP + WSS + Keychain client
│   │   ├── MockRelay.swift              # fake responses for simulator
│   │   ├── Views/QRScannerView.swift    # AVCaptureSession QR scanner
│   │   ├── AppIntents/
│   │   │   ├── DaemonAppShortcuts.swift       # AppShortcutsProvider
│   │   │   ├── ChatWithDaemonIntent.swift
│   │   │   ├── ReadFileIntent.swift
│   │   │   ├── WriteFileIntent.swift
│   │   │   ├── RemindMeIntent.swift
│   │   │   ├── WhereAmIIntent.swift
│   │   │   └── ClipboardToDaemonIntent.swift
│   │   ├── LiveActivities/
│   │   │   ├── DaemonActivityAttributes.swift
│   │   │   └── DaemonActivityView.swift       # WidgetKit ActivityConfiguration
│   │   ├── Shortcuts/ShortcutsInstaller.swift # first-run Siri donations
│   │   └── Resources/
│   │       ├── Shortcuts/shortcuts.json       # bundled phrase library
│   │       └── MockChatResponse.json
│   └── NotificationServiceExtension/
│       └── NotificationService.swift          # rich push + action buttons
└── README.md
```

## First-time setup (one-time)

1. Install XcodeGen:
   ```sh
   brew install xcodegen
   ```
2. Generate the Xcode project:
   ```sh
   cd ios/Daemon
   xcodegen generate
   open Daemon.xcodeproj
   ```
3. In Xcode → Signing & Capabilities for both targets:
   - Set your **Development Team**
   - Confirm the **Push Notifications** capability
   - Confirm **Background Modes → Remote notifications**
   - Confirm the **App Groups** capability (`group.page.daemon.shared`)
   - Confirm **Live Activities** is enabled (auto from `NSSupportsLiveActivities`)

## Running on the simulator

1. Pick any iOS 17+ simulator
2. Build & run (`⌘R`)
3. On the unpair screen, tap **Use Mock Relay (dev)** to bypass the network
   and exercise the chat UI against the bundled fixtures

The simulator cannot receive real APNs pushes, but you can simulate them:

```sh
xcrun simctl push booted page.daemon.ios ios/Daemon/test/silent-push.apns
```

(Create `silent-push.apns` locally with `{"aps":{"content-available":1}}`.)

## Running on device

1. Plug in an iPhone running iOS 17+
2. Trust the developer cert in Settings → General → VPN & Device Management
3. Build & run — first launch will ask for notification permission and
   camera permission (for QR scan)
4. Pair: on my.daemon.page → Settings → Pair new device → show QR → scan

## Deploying to TestFlight

Arthur's checklist once he has an Apple Developer account (\$99/yr):

1. **App Store Connect** → My Apps → **New App**
   - Name: `Daemon`
   - Bundle ID: `page.daemon.ios` (register under Certificates, Identifiers & Profiles first)
   - Primary language: English
2. **Register the App ID** in the Developer portal with:
   - Push Notifications
   - App Groups (`group.page.daemon.shared`)
3. **Register the extension App ID**: `page.daemon.ios.NotificationService`
4. **APNs Auth Key**: create an `.p8` key in the Developer portal and upload to
   the daemon relay (`web/`) so the relay can send pushes
5. **In Xcode**:
   - Set `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in `project.yml`,
     then re-run `xcodegen generate`
   - Product → Archive
   - Window → Organizer → Distribute App → TestFlight & App Store → Upload
6. **In App Store Connect** → TestFlight:
   - Add internal testers (instant) or external testers (Beta App Review, ~24h)
   - Up to 10,000 external testers worldwide, free
7. **Send the invite link** — testers install via the TestFlight app

## Relay endpoints the app talks to

- `POST https://my.daemon.page/api/pair` — `{action: "claim", code, device_id, device_name, platform}` → `{device_token, ws_url}`
- `POST https://my.daemon.page/api/chat` — `{message, threadId?, stream: false}` → `{message, threadId}`
- `WSS wss://my.daemon.page/ws/client` — foreground-only subscription
- `POST https://my.daemon.page/api/devices/apns` — register APNs token (relay must implement this route; stub for now)

## Known limitations / TODOs

- No background WebSocket (Apple kills it — all durable sync is APNs silent push)
- `drainPendingEvents` is a stub — needs a real "fetch events since cursor" endpoint on the relay
- `POST /api/devices/apns` doesn't exist yet on the relay — the client calls it, the relay needs to accept it
- Live Activities widget is declared on the main target; if builds complain, split it into a dedicated Widget Extension target in `project.yml`
- No unit tests yet — add `DaemonTests` target to `project.yml` once behavior stabilizes

## Protocol source of truth

Don't reinvent the protocol — read `/home/arthur/daemon/protocol/types.ts`.
The relay endpoints live in `/home/arthur/daemon/web/src/app/api/`.
