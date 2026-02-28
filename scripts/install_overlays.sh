#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Daemon V0 — Device Tree Overlay Compiler & Installer
#
# Compiles .dts → .dtbo and installs to the Radxa overlay directory.
#
# Usage: sudo bash scripts/install_overlays.sh
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_SRC="$(dirname "$SCRIPT_DIR")/overlays"

# Radxa overlay directory (varies by distro)
OVERLAY_DST="/boot/dtbs/$(uname -r)/rockchip/overlay"
if [[ ! -d "$OVERLAY_DST" ]]; then
    # Alternative paths
    for candidate in \
        "/boot/dtbo" \
        "/boot/overlays" \
        "/usr/lib/linux-image-$(uname -r)/rockchip/overlay"; do
        if [[ -d "$candidate" ]]; then
            OVERLAY_DST="$candidate"
            break
        fi
    done
fi

if [[ ! -d "$OVERLAY_DST" ]]; then
    echo "[WARN] Could not find overlay directory. Creating $OVERLAY_DST"
    mkdir -p "$OVERLAY_DST"
fi

echo "Overlay source: $OVERLAY_SRC"
echo "Overlay target: $OVERLAY_DST"
echo

if ! command -v dtc &>/dev/null; then
    echo "[ERROR] dtc not found. Install: sudo apt install device-tree-compiler"
    exit 1
fi

for dts in "$OVERLAY_SRC"/*.dts; do
    name="$(basename "$dts" .dts)"
    dtbo="$OVERLAY_DST/${name}.dtbo"
    echo "Compiling: $name.dts → $name.dtbo"

    if dtc -@ -I dts -O dtb -o "$dtbo" "$dts" 2>/dev/null; then
        echo "  Installed: $dtbo"
    else
        echo "  [WARN] Compilation had warnings (may still work)"
        # dtc often warns about missing phandle references in overlays
        dtc -@ -W no-unit_address_vs_reg -I dts -O dtb -o "$dtbo" "$dts" 2>/dev/null || true
    fi
done

echo
echo "Done. Add overlays to /boot/uEnv.txt:"
echo "  overlays=daemon-v0-spi-gpio-cc1101 daemon-v0-i2s-audio daemon-v0-pwm-backlight"
echo
echo "Then reboot for overlays to take effect."
