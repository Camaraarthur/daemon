#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Daemon V0 — First-Boot Hardware Bringup Validation
#
# Run this on first power-on to verify all subsystems are alive.
# Designed to be run interactively — prints human-readable results.
#
# Usage:  sudo bash scripts/bringup.sh
#
# Checks:
#   1. Kernel modules loaded
#   2. GPIO chips available
#   3. I2C bus scan → ADS1015 (0x48) + IP5328P (0x75)
#   4. SPI devices → spidev for display + spi-gpio for CC1101
#   5. USB hub → SL2.1A detected
#   6. Ethernet → RTL8152B interface up
#   7. Audio → ALSA card detected
#   8. VCCIO domain check (ADVISORY A-21)
#   9. Thermal zone readable
# ═══════════════════════════════════════════════════════════════════════

set -uo pipefail

PASS=0
FAIL=0
WARN=0

pass() { echo -e "  \033[0;32m[PASS]\033[0m $*"; ((PASS++)); }
fail() { echo -e "  \033[0;31m[FAIL]\033[0m $*"; ((FAIL++)); }
warn() { echo -e "  \033[1;33m[WARN]\033[0m $*"; ((WARN++)); }
info() { echo -e "  \033[0;36m[INFO]\033[0m $*"; }

echo "╔══════════════════════════════════════════╗"
echo "║   Daemon V0 — Hardware Bringup Check     ║"
echo "║   ECO #2026-03-GOLD                      ║"
echo "╚══════════════════════════════════════════╝"
echo

# ─── 1. Kernel modules ───────────────────────────────────────────────
echo "─── Kernel Modules ───"
for mod in i2c_dev spi_dev spi_gpio; do
    if lsmod | grep -q "^${mod//-/_}"; then
        pass "$mod loaded"
    else
        if modprobe "$mod" 2>/dev/null; then
            pass "$mod loaded (just loaded)"
        else
            fail "$mod NOT loaded and modprobe failed"
        fi
    fi
done
echo

# ─── 2. GPIO chips ───────────────────────────────────────────────────
echo "─── GPIO Chips ───"
if command -v gpiodetect &>/dev/null; then
    GPIO_CHIPS=$(gpiodetect 2>/dev/null | wc -l)
    if [[ "$GPIO_CHIPS" -gt 0 ]]; then
        pass "Found $GPIO_CHIPS GPIO chip(s)"
        gpiodetect 2>/dev/null | while read -r line; do info "$line"; done
    else
        fail "No GPIO chips found"
    fi
else
    warn "gpiodetect not installed (apt install libgpiod-dev)"
fi
echo

# ─── 3. I2C bus scan ─────────────────────────────────────────────────
echo "─── I2C Bus 1 ───"
if [[ -e /dev/i2c-1 ]]; then
    pass "/dev/i2c-1 exists"

    if command -v i2cdetect &>/dev/null; then
        I2C_OUT=$(i2cdetect -y 1 2>/dev/null)

        # Check for ADS1015 at 0x48
        if echo "$I2C_OUT" | grep -q "48"; then
            pass "ADS1015 ADC found at 0x48 (joystick)"
        else
            fail "ADS1015 NOT found at 0x48 — check J_JOY connector"
        fi

        # Check for IP5328P at 0x75
        if echo "$I2C_OUT" | grep -q "75"; then
            pass "IP5328P PMIC found at 0x75"
        else
            fail "IP5328P NOT found at 0x75"
            info "  Check: 470Ω series resistors, battery connected?"
            info "  ADVISORY A-21: If GPIO0 VCCIO = 1.8V, need TXS0102 level shifter"
        fi
    else
        warn "i2cdetect not installed (apt install i2c-tools)"
    fi
else
    fail "/dev/i2c-1 not found — modprobe i2c-dev"
fi
echo

# ─── 4. SPI devices ──────────────────────────────────────────────────
echo "─── SPI Devices ───"
SPI_COUNT=$(ls /dev/spidev* 2>/dev/null | wc -l)
if [[ "$SPI_COUNT" -gt 0 ]]; then
    pass "Found $SPI_COUNT SPI device(s):"
    ls /dev/spidev* 2>/dev/null | while read -r dev; do info "  $dev"; done
else
    fail "No SPI devices found"
    info "  Display SPI3: check device tree overlay for SPI3 enable"
    info "  CC1101 spi-gpio: check daemon-v0-spi-gpio-cc1101 overlay"
fi
echo

# ─── 5. USB hub ──────────────────────────────────────────────────────
echo "─── USB Hub (SL2.1A) ───"
if command -v lsusb &>/dev/null; then
    if lsusb 2>/dev/null | grep -qi "1a40:0101\|hub"; then
        pass "USB hub detected"
    else
        warn "USB hub not detected — SL2.1A may not have enumerated"
        info "  Check: Goobay USB-C bridge alignment, SL2.1A crystal"
    fi
    info "USB devices:"
    lsusb 2>/dev/null | while read -r line; do info "  $line"; done
else
    warn "lsusb not installed (apt install usbutils)"
fi
echo

# ─── 6. Ethernet ─────────────────────────────────────────────────────
echo "─── Ethernet (RTL8152B) ───"
ETH_IFACE=""
for iface in /sys/class/net/eth* /sys/class/net/en* /sys/class/net/usb*; do
    if [[ -e "$iface/device/driver" ]]; then
        DRIVER=$(basename "$(readlink "$iface/device/driver")")
        if [[ "$DRIVER" == "r8152" ]] || [[ "$DRIVER" == "cdc_ether" ]]; then
            ETH_IFACE=$(basename "$iface")
            break
        fi
    fi
done

if [[ -n "$ETH_IFACE" ]]; then
    pass "RTL8152B found: $ETH_IFACE (driver: $DRIVER)"
    if ip link show "$ETH_IFACE" 2>/dev/null | grep -q "state UP"; then
        pass "Link is UP"
        IP_ADDR=$(ip -4 -o addr show "$ETH_IFACE" 2>/dev/null | awk '{print $4}')
        if [[ -n "$IP_ADDR" ]]; then
            pass "IP address: $IP_ADDR"
        else
            warn "No IP address — check DHCP"
        fi
    else
        warn "Link is DOWN — check Ethernet cable"
    fi
else
    fail "RTL8152B Ethernet not found"
    info "  Check: 3V3_CLEAN rail (AP2112K LDO), center tap bias on MagJack"
fi
echo

# ─── 7. Audio ────────────────────────────────────────────────────────
echo "─── Audio (I2S) ───"
if command -v aplay &>/dev/null; then
    if aplay -l 2>/dev/null | grep -qi "card"; then
        pass "ALSA audio card detected"
        aplay -l 2>/dev/null | grep "^card" | while read -r line; do info "  $line"; done
    else
        warn "No ALSA audio cards — I2S overlay may not be loaded"
        info "  Load: daemon-v0-i2s-audio overlay"
    fi
else
    warn "aplay not installed (apt install alsa-utils)"
fi
echo

# ─── 8. VCCIO Domain (ADVISORY A-21) ─────────────────────────────────
echo "─── VCCIO Check (ADVISORY A-21) ───"
info "IMPORTANT: Verify I2C1 VCCIO domain manually"
info "  1. Probe header pin 3 (I2C1_SDA) idle voltage with multimeter"
info "  2. If idle HIGH ≈ 3.3V → OK, no action needed"
info "  3. If idle HIGH ≈ 1.8V → NEED TXS0102 level shifter rework"
info "  (This cannot be tested in software — measure with scope/DMM)"
warn "Manual verification required"
echo

# ─── 9. Thermal ──────────────────────────────────────────────────────
echo "─── Thermal ───"
if [[ -f /sys/class/thermal/thermal_zone0/temp ]]; then
    TEMP_RAW=$(cat /sys/class/thermal/thermal_zone0/temp)
    TEMP_C=$((TEMP_RAW / 1000))
    if [[ "$TEMP_C" -lt 70 ]]; then
        pass "CPU temperature: ${TEMP_C}°C (safe)"
    elif [[ "$TEMP_C" -lt 85 ]]; then
        warn "CPU temperature: ${TEMP_C}°C (warm — throttling may occur in pocket)"
    else
        fail "CPU temperature: ${TEMP_C}°C (DVFS throttling active)"
    fi
else
    warn "Thermal zone not readable"
fi
echo

# ─── Summary ──────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════"
echo -e "  \033[0;32mPASS: $PASS\033[0m   \033[0;31mFAIL: $FAIL\033[0m   \033[1;33mWARN: $WARN\033[0m"
echo "═══════════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
    echo
    echo "Some checks FAILED. Review the output above and fix issues before"
    echo "starting the daemon service."
    exit 1
fi
