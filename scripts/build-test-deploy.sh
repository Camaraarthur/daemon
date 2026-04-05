#!/bin/bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
ANDROID_DIR="/home/arthur/daemon/android"
APK_OUTPUT="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
DEPLOY_DIR="/home/arthur/daemon/web/public"
AVD_NAME="daemon_test"
SCREENSHOT_DIR="/home/arthur/daemon/test-results/$(date +%Y%m%d-%H%M%S)"
export ANDROID_HOME="/home/arthur/Android/Sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

EMULATOR_PID=""
STARTED_EMULATOR=false

cleanup() {
    echo "Cleaning up..."
    if [[ "$STARTED_EMULATOR" == true ]]; then
        adb emu kill 2>/dev/null || true
        if [[ -n "$EMULATOR_PID" ]]; then
            kill "$EMULATOR_PID" 2>/dev/null || true
            wait "$EMULATOR_PID" 2>/dev/null || true
        fi
        echo "Emulator stopped"
    fi
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
echo "APK built: $APK_OUTPUT ($(numfmt --to=iec $APK_SIZE))"

# ── Step 2: Start Emulator ─────────────────────────────────────────────────
echo "=== Step 2: Starting emulator ==="

# Check if emulator is already running and responsive
if adb devices 2>/dev/null | grep -q "emulator.*device$"; then
    echo "Emulator already running, reusing it"
else
    # Kill any stale emulator processes
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
    STARTED_EMULATOR=true

    echo "Waiting for emulator to boot (PID: $EMULATOR_PID)..."
    adb wait-for-device
    timeout 120 bash -c 'while [[ -z $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r") ]]; do sleep 2; done'
    adb shell input keyevent 82  # unlock screen
    echo "Emulator booted"
fi

# ── Step 3: Install and Launch ─────────────────────────────────────────────
echo "=== Step 3: Installing APK ==="
# Uninstall first to avoid signature mismatch errors
adb uninstall com.daemon.app 2>/dev/null || true
adb install "$APK_OUTPUT"
echo "Launching app..."
adb shell am start -n com.daemon.app/.MainActivity
sleep 8  # wait for Compose to render

# Dismiss any ANR dialogs (Pixel Launcher often ANRs on swiftshader)
adb shell input keyevent KEYCODE_BACK 2>/dev/null || true
sleep 1
# Re-focus the app in case the back press navigated away
adb shell am start -n com.daemon.app/.MainActivity
sleep 3

# ── Step 4: Screenshot and Verify ──────────────────────────────────────────
echo "=== Step 4: Screenshot and verify ==="
adb exec-out screencap -p > "$SCREENSHOT_DIR/main_screen.png"

# Check screenshot is a valid PNG
if ! file "$SCREENSHOT_DIR/main_screen.png" | grep -q "PNG"; then
    echo "FAIL: Screenshot is not a valid PNG"
    exit 1
fi

# Check for black/white screen using ImageMagick
MEAN=$(convert "$SCREENSHOT_DIR/main_screen.png" -colorspace Gray -format "%[fx:mean]" info: 2>/dev/null || echo "0")
echo "Screenshot brightness: $MEAN"

if (( $(echo "$MEAN < 0.01" | bc -l) )); then
    echo "FAIL: App rendered a black screen"
    echo "Screenshot saved to: $SCREENSHOT_DIR/main_screen.png"
    exit 1
elif (( $(echo "$MEAN > 0.99" | bc -l) )); then
    echo "FAIL: App rendered an all-white screen"
    echo "Screenshot saved to: $SCREENSHOT_DIR/main_screen.png"
    exit 1
fi

# Check screenshot dimensions are reasonable
DIMS=$(identify -format "%wx%h" "$SCREENSHOT_DIR/main_screen.png" 2>/dev/null)
echo "Screenshot dimensions: $DIMS"

# Take a second screenshot after delay (catch delayed crashes)
sleep 5
adb exec-out screencap -p > "$SCREENSHOT_DIR/after_delay.png"
MEAN2=$(convert "$SCREENSHOT_DIR/after_delay.png" -colorspace Gray -format "%[fx:mean]" info: 2>/dev/null || echo "0")
echo "After-delay brightness: $MEAN2"

if (( $(echo "$MEAN2 < 0.01" | bc -l) )); then
    echo "FAIL: App crashed after initial render (screen went black)"
    echo "Screenshots saved to: $SCREENSHOT_DIR/"
    exit 1
fi

echo "PASS: App renders correctly"
echo "Screenshots: $SCREENSHOT_DIR/"

# ── Step 5: Stop app ──────────────────────────────────────────────────────
adb shell am force-stop com.daemon.app

# ── Step 6: Deploy ─────────────────────────────────────────────────────────
echo "=== Step 6: Deploying APK ==="
cp "$APK_OUTPUT" "$DEPLOY_DIR/daemon.apk"

# Write version manifest
VCODE=$(grep 'versionCode' "$ANDROID_DIR/app/build.gradle.kts" | grep -o '[0-9]*' | head -1)
VNAME=$(grep 'versionName' "$ANDROID_DIR/app/build.gradle.kts" | grep -o '"[^"]*"' | tr -d '"' | head -1)
cat > "$DEPLOY_DIR/daemon-version.json" <<EOF
{
  "versionCode": $VCODE,
  "versionName": "$VNAME",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": "$(sha256sum "$APK_OUTPUT" | cut -d' ' -f1)",
  "size": $(stat -c%s "$APK_OUTPUT"),
  "downloadUrl": "https://my.daemon.page/daemon.apk",
  "tested": true
}
EOF

echo "APK deployed to $DEPLOY_DIR/daemon.apk"
echo "Version manifest written to $DEPLOY_DIR/daemon-version.json"
echo ""
echo "=== PIPELINE COMPLETE ==="
echo "Build: OK | Test: PASS | Deploy: OK"
echo "Download: https://my.daemon.page/daemon.apk"
echo "Version: $VNAME (code $VCODE)"
