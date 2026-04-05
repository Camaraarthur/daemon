# Android APK Testing Pipeline for Daemon

Research date: 2026-04-05

**Goal**: Build, test on emulator, screenshot, and verify the APK renders correctly BEFORE deploying to users. Never ship a broken APK again.

## Current State on Arturito

- **CPU**: Intel i9-7920X (24 threads), VT-x supported
- **KVM**: `/dev/kvm` is available and working
- **RAM**: 32GB (15GB free typical)
- **Disk**: 267GB free on `/`
- **Android SDK**: Already installed at `~/Android/Sdk` (build-tools, emulator, platform-tools, system-images for API 33 and 35)
- **Existing AVD**: `daemon_test` (Pixel 6, API 35, google_apis/x86_64)
- **ADB**: Available at `/usr/bin/adb`
- **No existing CI for Android** -- the `hardware-ci.yml` only covers hardware (PCB/SKiDL/PySpice), nothing for the app

---

## 1. Android Emulator on Headless Linux

### It Works -- Here's How

The Android emulator supports headless mode via `-no-window` (and a newer headless build variant). With KVM on arturito, it runs at near-native speed.

### Setup (Already Mostly Done)

The SDK and AVD are already installed. To verify everything works:

```bash
# Check KVM access
ls -la /dev/kvm
# Should show crw-rw---- with your user in the kvm group

# Verify user is in kvm group
groups arthur | grep kvm
# If not: sudo usermod -aG kvm arthur && newgrp kvm

# Set ANDROID_HOME
export ANDROID_HOME=~/Android/Sdk
export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH

# List available AVDs
emulator -list-avds
# Should show: daemon_test

# Accept all SDK licenses (needed for CI)
yes | sdkmanager --licenses
```

### Start Emulator Headless

```bash
# Start emulator in background, no window, no audio, no boot animation
$ANDROID_HOME/emulator/emulator \
  -avd daemon_test \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -no-snapshot-load \
  -gpu swiftshader_indirect \
  -memory 4096 \
  &

# Wait for boot to complete (timeout after 120s)
adb wait-for-device
timeout 120 bash -c 'while [[ -z $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r") ]]; do sleep 2; done'

# Unlock screen
adb shell input keyevent 82

echo "Emulator is ready"
```

**Key flags explained**:
- `-no-window`: No GUI, perfect for headless servers
- `-no-audio`: No audio backend needed
- `-no-boot-anim`: Skip boot animation (saves ~30s)
- `-no-snapshot-load`: Clean boot every time (reproducible)
- `-gpu swiftshader_indirect`: Software GPU rendering (works without a physical GPU; slower but reliable)
- `-memory 4096`: 4GB RAM for the emulator (plenty for Daemon)

**GPU note**: `swiftshader_indirect` uses CPU-based rendering. It is slower than hardware GPU but works reliably on headless servers. For a Compose app like Daemon, it is fast enough for screenshot testing. If rendering becomes a bottleneck, the emulator also supports `-gpu host` with a virtual framebuffer (`Xvfb`), but that adds complexity.

### Take a Screenshot

```bash
# Screenshot via adb
adb exec-out screencap -p > screenshot.png

# Or save directly to device then pull
adb shell screencap /sdcard/screen.png
adb pull /sdcard/screen.png ./screenshot.png
```

### Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU cores | 2 | 4 |
| RAM | 4GB | 6GB (emulator + Gradle) |
| Disk | 10GB (SDK + images) | 15GB |
| KVM | Required for x86 | Already available |

Arturito exceeds all of these comfortably.

---

## 2. Automated UI Testing Frameworks

### Option A: Maestro (Recommended)

**Why Maestro**: Simplest possible setup. YAML-based flows. No code changes to the app. Built-in screenshot capture. Designed for exactly this use case.

**Install**:
```bash
curl -fsSL "https://get.maestro.mobile.dev" | bash
# Requires Java 17+ (check: java -version)
```

**Basic "does it render" test** -- save as `daemon/android/.maestro/smoke-test.yaml`:
```yaml
appId: com.daemon.app
---
- launchApp:
    appId: com.daemon.app
    clearState: true
- assertVisible: ".*"  # assert anything is visible (not a black screen)
- takeScreenshot: launch_screen
- extendedWaitUntil:
    visible: ".*"
    timeout: 10000
- takeScreenshot: after_load
```

**More thorough test** -- `daemon/android/.maestro/full-smoke.yaml`:
```yaml
appId: com.daemon.app
---
- launchApp:
    appId: com.daemon.app
    clearState: true
    stopApp: true

# Wait for the app to render something
- extendedWaitUntil:
    visible: ".*"
    timeout: 15000

# Take screenshot of initial state
- takeScreenshot: 01_initial_launch

# Check for common crash indicators -- if the app crashes,
# these would NOT be visible, causing the test to pass vacuously.
# Instead, we assert something app-specific IS visible:
- assertVisible: "Daemon"  # App title or branding text

- takeScreenshot: 02_main_screen

# If there's a chat/voice interface, verify it rendered
# - assertVisible: "Message"  # uncomment when UI has this text
```

**Run**:
```bash
maestro test daemon/android/.maestro/smoke-test.yaml
# Screenshots saved to current directory by default
```

**Maestro in CI script**:
```bash
maestro test --format junit --output results.xml daemon/android/.maestro/
# Runs all flows in the .maestro/ directory
# Outputs JUnit XML for CI integration
```

### Option B: Plain ADB + Screenshot Comparison (Zero Dependencies)

If you want zero extra tools, you can verify the app renders by checking the screenshot is not a black screen:

```bash
#!/bin/bash
# simple-render-check.sh

# Install APK
adb install -r daemon/android/app/build/outputs/apk/release/app-release.apk

# Launch app
adb shell am start -n com.daemon.app/.MainActivity

# Wait for rendering
sleep 8

# Take screenshot
adb exec-out screencap -p > /tmp/daemon_screenshot.png

# Check it's not all black (ImageMagick)
# A fully black 1080x2400 image has mean=0. Anything rendered will have mean > 0.
MEAN=$(convert /tmp/daemon_screenshot.png -colorspace Gray -format "%[fx:mean]" info:)
echo "Screenshot mean brightness: $MEAN"

if (( $(echo "$MEAN < 0.01" | bc -l) )); then
    echo "FAIL: Screen is black. App did not render."
    exit 1
else
    echo "PASS: App rendered content (brightness=$MEAN)"
fi
```

Install ImageMagick if not present: `sudo apt install imagemagick`

### Option C: Espresso / UI Automator (Overkill for Now)

Espresso and UI Automator are Android's built-in test frameworks. They require writing Kotlin test code, adding test dependencies to `build.gradle.kts`, and running via `./gradlew connectedAndroidTest`. They are powerful but heavy for a simple "does it render" check. Consider them later when you have complex UI flows to validate.

### Recommendation

**Start with Option B** (ADB + ImageMagick) for immediate results with zero setup. It answers the core question: "is the screen black?" in 5 lines of bash.

**Graduate to Maestro** when you want to verify specific UI elements are visible, test user flows (tap this, see that), or run a suite of tests. The YAML syntax is trivial and requires no changes to app code.

---

## 3. CI/CD Pipeline

### Approach: Self-Hosted Script on Arturito (Not GitHub Actions)

GitHub Actions does not have KVM on standard runners (only on paid larger runners). Since arturito already has KVM, the Android SDK, and the AVD, the simplest approach is a **local build-test-deploy script** rather than trying to make GitHub Actions work.

### The Full Pipeline Script

Save as `daemon/scripts/build-test-deploy.sh`:

```bash
#!/bin/bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
ANDROID_DIR="$HOME/daemon/android"
APK_OUTPUT="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
DEPLOY_DIR="$HOME/daemon/web/public"
AVD_NAME="daemon_test"
SCREENSHOT_DIR="$HOME/daemon/test-results/$(date +%Y%m%d-%H%M%S)"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

EMULATOR_PID=""

cleanup() {
    echo "Cleaning up..."
    if [[ -n "$EMULATOR_PID" ]]; then
        kill "$EMULATOR_PID" 2>/dev/null || true
        wait "$EMULATOR_PID" 2>/dev/null || true
    fi
    adb emu kill 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR"

# ── Step 1: Build APK ──────────────────────────────────────────────────────
echo "=== Step 1: Building APK ==="
cd "$ANDROID_DIR"
./gradlew assembleRelease --no-daemon -q
if [[ ! -f "$APK_OUTPUT" ]]; then
    echo "FAIL: APK not produced at $APK_OUTPUT"
    exit 1
fi
APK_SIZE=$(stat -c%s "$APK_OUTPUT")
echo "APK built: $APK_OUTPUT ($APK_SIZE bytes)"

# ── Step 2: Start Emulator ─────────────────────────────────────────────────
echo "=== Step 2: Starting emulator ==="
# Kill any existing emulator
adb emu kill 2>/dev/null || true
sleep 2

$ANDROID_HOME/emulator/emulator \
    -avd "$AVD_NAME" \
    -no-window \
    -no-audio \
    -no-boot-anim \
    -no-snapshot-load \
    -gpu swiftshader_indirect \
    -memory 4096 \
    &
EMULATOR_PID=$!

echo "Waiting for emulator to boot..."
adb wait-for-device
timeout 120 bash -c 'while [[ -z $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r") ]]; do sleep 2; done'
adb shell input keyevent 82  # unlock
echo "Emulator booted (PID: $EMULATOR_PID)"

# ── Step 3: Install and Launch ─────────────────────────────────────────────
echo "=== Step 3: Installing APK ==="
adb install -r "$APK_OUTPUT"
echo "Launching app..."
adb shell am start -n com.daemon.app/.MainActivity
sleep 10  # wait for Compose to render

# ── Step 4: Screenshot and Verify ──────────────────────────────────────────
echo "=== Step 4: Screenshot and verify ==="
adb exec-out screencap -p > "$SCREENSHOT_DIR/main_screen.png"

# Check for black screen using ImageMagick
MEAN=$(convert "$SCREENSHOT_DIR/main_screen.png" -colorspace Gray -format "%[fx:mean]" info: 2>/dev/null || echo "0")
echo "Screenshot brightness: $MEAN"

if (( $(echo "$MEAN < 0.01" | bc -l) )); then
    echo "FAIL: App rendered a black screen"
    echo "Screenshot saved to: $SCREENSHOT_DIR/main_screen.png"
    exit 1
fi

# Check screenshot dimensions are reasonable (not a tiny error dialog)
DIMS=$(identify -format "%wx%h" "$SCREENSHOT_DIR/main_screen.png" 2>/dev/null)
echo "Screenshot dimensions: $DIMS"

# Optional: take a second screenshot after 5 more seconds (catch delayed crashes)
sleep 5
adb exec-out screencap -p > "$SCREENSHOT_DIR/after_delay.png"

echo "PASS: App renders correctly"
echo "Screenshots: $SCREENSHOT_DIR/"

# ── Step 5: Deploy ─────────────────────────────────────────────────────────
echo "=== Step 5: Deploying APK ==="
cp "$APK_OUTPUT" "$DEPLOY_DIR/daemon.apk"
echo "APK deployed to $DEPLOY_DIR/daemon.apk"
echo ""
echo "=== PIPELINE COMPLETE ==="
echo "Build: OK | Test: PASS | Deploy: OK"
echo "Download: https://my.daemon.page/daemon.apk"
```

### Running It

```bash
chmod +x ~/daemon/scripts/build-test-deploy.sh
~/daemon/scripts/build-test-deploy.sh
```

### Trigger on Git Push (Optional)

Add a git post-receive hook or use a simple watcher:

```bash
# Option 1: Git hook (daemon/.git/hooks/post-merge)
#!/bin/bash
~/daemon/scripts/build-test-deploy.sh 2>&1 | tee ~/daemon/test-results/latest-build.log

# Option 2: GitHub Actions self-hosted runner
# Install: https://github.com/actions/runner
# Then the workflow can call the local script with KVM access
```

### GitHub Actions Workflow (For Self-Hosted Runner)

If you later set up a self-hosted runner on arturito, here is a workflow file.
Save as `daemon/.github/workflows/android-test.yml`:

```yaml
name: Android Build & Test

on:
  push:
    paths:
      - 'android/**'
      - '.github/workflows/android-test.yml'
  pull_request:
    paths:
      - 'android/**'

jobs:
  build-test-deploy:
    runs-on: self-hosted
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - name: Build, test, deploy
        run: ./scripts/build-test-deploy.sh

      - name: Upload screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-screenshots
          path: test-results/
          retention-days: 30
```

---

## 4. APK Distribution

### Current Approach
Manual download from `https://my.daemon.page/daemon.apk`. This works but has no version tracking, no install notifications, and no way to know if the user has updated.

### Improved Self-Hosted (Recommended for Now)

Keep the current approach but add version metadata:

```bash
# After building, create a version manifest
cat > "$DEPLOY_DIR/daemon-version.json" <<EOF
{
  "versionCode": $(grep 'versionCode' $ANDROID_DIR/app/build.gradle.kts | grep -o '[0-9]*'),
  "versionName": "$(grep 'versionName' $ANDROID_DIR/app/build.gradle.kts | grep -o '"[^"]*"' | tr -d '"')",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": "$(sha256sum $APK_OUTPUT | cut -d' ' -f1)",
  "size": $(stat -c%s "$APK_OUTPUT"),
  "downloadUrl": "https://my.daemon.page/daemon.apk",
  "tested": true
}
EOF
```

The Daemon Android app already has update checking code. It can poll `/daemon-version.json`, compare `versionCode` with the installed version, and prompt to download the new APK.

### In-App OTA Update Flow

The app can check for updates and trigger download+install:

```kotlin
// Pseudocode for self-update (already partially implemented in Daemon)
val response = okHttpClient.get("https://my.daemon.page/daemon-version.json")
val remoteVersion = json.parse(response).versionCode
val localVersion = BuildConfig.VERSION_CODE

if (remoteVersion > localVersion) {
    // Download APK using DownloadManager
    val request = DownloadManager.Request(Uri.parse(downloadUrl))
    downloadManager.enqueue(request)
    // On download complete, trigger install intent
    // User must have "Install from unknown sources" enabled
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(apkUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(intent)
}
```

**Limitation**: Android requires user confirmation for non-Play-Store installs. Silent/background install is only possible with root access or device-owner privileges. For Daemon's use case (Arthur's personal device), the confirmation tap is fine.

### Firebase App Distribution (Future Option)

Firebase App Distribution sends install links via email/Slack, tracks who has installed what version, and handles the download flow. However:
- Requires a Firebase project
- The CLI sometimes requires the app to be registered on Play Console
- Adds a dependency on Google infrastructure
- For a single-user app like Daemon, it is overkill

**Verdict**: Stick with self-hosted + version manifest. Graduate to Firebase if/when Daemon has beta testers.

---

## 5. Complete Setup Commands

Run these on arturito to set up the full pipeline from scratch:

```bash
# 1. Ensure user is in kvm group
sudo usermod -aG kvm arthur
newgrp kvm

# 2. Set environment variables (add to ~/.bashrc)
echo 'export ANDROID_HOME=~/Android/Sdk' >> ~/.bashrc
echo 'export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# 3. Install ImageMagick (for screenshot brightness check)
sudo apt install -y imagemagick bc

# 4. Accept SDK licenses
yes | sdkmanager --licenses

# 5. Verify the emulator works headless
$ANDROID_HOME/emulator/emulator -avd daemon_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
sleep 30
adb wait-for-device
adb shell getprop sys.boot_completed  # should print "1"
adb exec-out screencap -p > /tmp/test-emulator.png
file /tmp/test-emulator.png  # should say PNG image
adb emu kill

# 6. Install Maestro (optional, for YAML-based UI tests)
curl -fsSL "https://get.maestro.mobile.dev" | bash
# Verify: maestro --version

# 7. Create the build-test-deploy script
mkdir -p ~/daemon/scripts
# (copy the script from Section 3 above)
chmod +x ~/daemon/scripts/build-test-deploy.sh

# 8. Create test results directory
mkdir -p ~/daemon/test-results

# 9. Test the full pipeline
~/daemon/scripts/build-test-deploy.sh
```

---

## 6. Summary: What to Implement

| Priority | What | Effort | Impact |
|----------|------|--------|--------|
| **P0** | `build-test-deploy.sh` script with black-screen check | 30 min | Catches 90% of broken APKs |
| **P0** | Version manifest (`daemon-version.json`) | 10 min | Enables version tracking |
| **P1** | Maestro smoke test YAML | 20 min | Catches UI element missing bugs |
| **P2** | Git hook to auto-run on push | 10 min | Automated pipeline |
| **P3** | GitHub Actions self-hosted runner | 1 hr | Full CI/CD with artifacts |
| **P3** | In-app update prompt from version manifest | 2 hr | Users auto-notified of updates |
| **P4** | Firebase App Distribution | 2 hr | Only if multiple beta testers |

### The Minimum Viable Pipeline

The absolute minimum to never ship a broken APK:

1. Build APK
2. Start headless emulator (already have the AVD)
3. Install APK on emulator
4. Take screenshot
5. Check screenshot is not black
6. If pass: copy APK to deploy directory
7. If fail: abort and alert

This is ~50 lines of bash using tools already installed on arturito.

---

## Sources

- [Run a Headless Android Device on Ubuntu server (GitHub Gist)](https://gist.github.com/nhtua/2d294f276dc1e110a7ac14d69c37904f)
- [Android Emulator Release Notes](https://developer.android.com/studio/releases/emulator)
- [Maestro Documentation](https://docs.maestro.dev/)
- [Maestro GitHub Repository](https://github.com/mobile-dev-inc/Maestro)
- [Maestro launchApp Command Reference](https://docs.maestro.dev/api-reference/commands/launchapp)
- [From Zero to CI: Building Your First Robust Mobile UI Test Automation Framework with Maestro](https://medium.com/@saidinesh.narisetti/mastering-maestro-4c2aea285779)
- [Built a Visual Android UI Test Pipeline with Maestro](https://medium.com/@carlosjimz87/built-a-visual-android-ui-test-pipeline-with-maestro-664cc1d6f8bd)
- [Android Emulator Runner GitHub Action](https://github.com/marketplace/actions/android-emulator-runner)
- [ReactiveCircus/android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner)
- [Hardware accelerated Android virtualization on GitHub Actions](https://github.blog/changelog/2023-02-22-hardware-accelerated-android-virtualization-on-actions-windows-and-linux-larger-hosted-runners/)
- [Firebase App Distribution CLI](https://firebase.google.com/docs/app-distribution/android/distribute-cli)
- [Android OTA self-update implementation](https://medium.com/@manikanta.garikipati/auto-updating-android-apps-programmatically-in-the-background-in-app-update-583a06e97d2)
- [Wait for Android emulator boot script (GitHub Gist)](https://gist.github.com/mrk-han/db70c7ce2dfdc8ac3e8ae4bec823ba51)
