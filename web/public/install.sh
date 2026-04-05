#!/bin/bash
# daemon CLI installer — no admin required
# Usage: curl -sSL https://daemon.page/install.sh | bash

set -e

DAEMON_DIR="$HOME/.daemon"
DAEMON_BIN="$DAEMON_DIR/daemon.mjs"
DAEMON_URL="https://my.daemon.page/cli/daemon.mjs"

echo "🔧 Installing daemon CLI..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install it first:"
    echo "   macOS:  brew install node"
    echo "   Linux:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required (found: $(node -v))"
    exit 1
fi

# Create daemon directory
mkdir -p "$DAEMON_DIR"

# Download daemon CLI
echo "📥 Downloading daemon CLI..."
curl -sSL "$DAEMON_URL" -o "$DAEMON_BIN"
chmod +x "$DAEMON_BIN"

# Install ws dependency (the only npm dep needed)
cd "$DAEMON_DIR"
if [ ! -f package.json ]; then
    echo '{"type":"module","dependencies":{"ws":"^8.20.0"}}' > package.json
fi
npm install --silent 2>/dev/null

# Create a wrapper script
cat > "$DAEMON_DIR/daemon" << 'WRAPPER'
#!/bin/bash
cd "$HOME/.daemon"
exec node "$HOME/.daemon/daemon.mjs" "$@"
WRAPPER
chmod +x "$DAEMON_DIR/daemon"

echo "✅ Installed to $DAEMON_DIR"
echo ""

# Add to PATH if not already there
if [[ ":$PATH:" != *":$DAEMON_DIR:"* ]]; then
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_RC="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_RC" ] && ! grep -q '.daemon' "$SHELL_RC" 2>/dev/null; then
        echo 'export PATH="$HOME/.daemon:$PATH"' >> "$SHELL_RC"
        echo "📝 Added ~/.daemon to PATH in $SHELL_RC"
    fi
fi

echo "✅ Installed! Now pair your device:"
echo ""
echo "   1. Go to https://daemon.page and sign in"
echo "   2. Click \"Connect Device\" to get a pairing code"
echo "   3. Run: daemon pair <CODE>"
echo ""
echo "Or run daemon directly:"
echo "   daemon                    # Run in foreground"
echo "   daemon --install          # Install as background service (auto-starts on login)"
echo "   daemon --name='My Mac'    # Set device name"
echo ""
echo "Your device will appear at https://my.daemon.page once connected."
