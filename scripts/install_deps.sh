#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Daemon V0 — Dependency Installer
# Installs all system packages and Python modules needed by the daemon.
#
# Run as root:  sudo bash scripts/install_deps.sh
#
# This installs:
#   A. Bus communication tools (i2c-tools, spidev, libgpiod)
#   B. System enumeration (lsusb, lshw, ethtool)
#   C. Device tree compiler (dtc)
#   D. Audio tools (alsa-utils)
#   E. Network tools (curl, ssh, etc.)
#   F. Security/hardware research tools
#   G. Python dependencies (smbus2, spidev, gpiod, etc.)
#   H. Kernel module loading
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root (sudo)"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

info "═══ Daemon V0 Dependency Installer ═══"
info "Project: $PROJECT_DIR"

# ─── A. System packages ──────────────────────────────────────────────
info "Installing system packages..."
apt-get update -qq

# Bus communication
apt-get install -y -qq \
    i2c-tools \
    spi-tools \
    libgpiod-dev \
    libgpiod2 \
    python3-libgpiod \
    || warn "Some bus tool packages not available (non-critical)"

# System enumeration
apt-get install -y -qq \
    usbutils \
    pciutils \
    lshw \
    ethtool \
    net-tools \
    iproute2 \
    || warn "Some enumeration packages not available"

# Device tree
apt-get install -y -qq \
    device-tree-compiler \
    || warn "dtc not available (cannot compile overlays)"

# Audio
apt-get install -y -qq \
    alsa-utils \
    v4l-utils \
    || warn "Audio/IR tools not available"

# Network
apt-get install -y -qq \
    curl \
    wget \
    dnsutils \
    openssh-client \
    openssh-server \
    git \
    jq \
    || warn "Some network tools not available"

# Python build essentials
apt-get install -y -qq \
    python3-dev \
    python3-pip \
    python3-venv \
    build-essential \
    || error "Python build tools are REQUIRED"

# ─── B. Security research tools (optional) ───────────────────────────
info "Installing security research tools (optional)..."
apt-get install -y -qq \
    nmap \
    tcpdump \
    minicom \
    screen \
    binwalk \
    || warn "Some security tools not available (optional)"

# Heavier tools — install only if space allows
AVAILABLE_MB=$(df --output=avail -BM / | tail -1 | tr -d 'M ')
if [[ "$AVAILABLE_MB" -gt 2000 ]]; then
    info "Sufficient space ($AVAILABLE_MB MB free) — installing extended tools..."
    apt-get install -y -qq \
        gdb-multiarch \
        openocd \
        flashrom \
        || warn "Some extended tools not available"
else
    warn "Low disk space ($AVAILABLE_MB MB) — skipping extended security tools"
fi

# ─── C. Python dependencies ──────────────────────────────────────────
info "Installing Python dependencies..."
pip3 install --break-system-packages -q \
    smbus2 \
    spidev \
    gpiod \
    pyserial \
    pyudev \
    rpi-ws281x \
    Pillow \
    pyyaml \
    pyusb \
    || warn "Some Python packages failed to install"

# ─── D. Kernel modules ───────────────────────────────────────────────
info "Loading kernel modules..."
MODULES=(i2c-dev spi-dev spi-gpio spi-bitbang pwm-rockchip)
for mod in "${MODULES[@]}"; do
    if modprobe "$mod" 2>/dev/null; then
        info "  Loaded: $mod"
    else
        warn "  Could not load: $mod (may not exist on this kernel)"
    fi
done

# Persist modules across reboot
MODULES_FILE="/etc/modules-load.d/daemon-v0.conf"
info "Persisting kernel modules to $MODULES_FILE"
cat > "$MODULES_FILE" << 'EOF'
# Daemon V0 — required kernel modules
i2c-dev
spi-dev
spi-gpio
spi-bitbang
EOF

# ─── E. User and groups ──────────────────────────────────────────────
info "Setting up daemon user and groups..."
if ! id daemon &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin daemon
    info "Created system user: daemon"
fi

# Add daemon user to hardware groups
for group in i2c spi gpio dialout video audio plugdev; do
    if getent group "$group" &>/dev/null; then
        usermod -aG "$group" daemon 2>/dev/null || true
    fi
done

# ─── F. I2C/SPI permissions ──────────────────────────────────────────
info "Setting up udev rules for hardware access..."
UDEV_RULES="/etc/udev/rules.d/99-daemon-v0.rules"
cat > "$UDEV_RULES" << 'EOF'
# Daemon V0 — hardware access udev rules
# I2C devices
SUBSYSTEM=="i2c-dev", GROUP="i2c", MODE="0660"
# SPI devices
SUBSYSTEM=="spidev", GROUP="spi", MODE="0660"
# GPIO chardev
SUBSYSTEM=="gpio", GROUP="gpio", MODE="0660"
KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
# LIRC (IR blaster)
SUBSYSTEM=="lirc", GROUP="dialout", MODE="0660"
EOF
udevadm control --reload-rules
udevadm trigger

# ─── G. Install daemon to /opt ───────────────────────────────────────
info "Installing daemon to /opt/daemon-v0..."
INSTALL_DIR="/opt/daemon-v0"
mkdir -p "$INSTALL_DIR"
cp -r "$PROJECT_DIR"/daemon_core "$INSTALL_DIR/"
cp -r "$PROJECT_DIR"/hal "$INSTALL_DIR/"
cp -r "$PROJECT_DIR"/specs "$INSTALL_DIR/"
cp -r "$PROJECT_DIR"/overlays "$INSTALL_DIR/"
cp "$PROJECT_DIR"/ARCHITECTURE.md "$INSTALL_DIR/" 2>/dev/null || true
chown -R daemon:daemon "$INSTALL_DIR"

# ─── H. Install systemd service ──────────────────────────────────────
info "Installing systemd service..."
cp "$PROJECT_DIR/systemd/daemon-v0.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable daemon-v0
info "Service installed. Start with: sudo systemctl start daemon-v0"

echo
info "═══ Installation complete ═══"
info "Next steps:"
info "  1. Compile and install device tree overlays:"
info "     cd $PROJECT_DIR/overlays && bash ../scripts/install_overlays.sh"
info "  2. Run hardware bringup scan:"
info "     python3 -m daemon_core.main scan"
info "  3. Start the daemon:"
info "     sudo systemctl start daemon-v0"
info "  4. Monitor logs:"
info "     journalctl -u daemon-v0 -f"
