#!/bin/bash
# Generate a concise repo map showing file structure + key exports/functions
# Output: stdout as markdown
# Usage: ./scripts/repo-map.sh > REPO_MAP.md

REPO="/home/arthur/daemon"

echo "# Daemon Codebase Map"
echo "Generated: $(date -Iseconds)"
echo ""

# File tree (exclude noise directories)
echo "## File Tree"
find "$REPO" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.mjs" -o -name "*.py" -o -name "*.kt" -o -name "*.rs" \) \
  ! -path "*/node_modules/*" ! -path "*/.next/*" ! -path "*/target/*" ! -path "*/build/*" \
  ! -path "*/.git/*" ! -path "*/archive/*" ! -path "*/__pycache__/*" \
  ! -path "*/.venv/*" ! -path "*/venv/*" ! -path "*/.gradle/*" ! -path "*/test-results/*" \
  | sort | sed "s|$REPO/||" | while read -r f; do
    echo "- $f"
  done

echo ""
echo "## API Routes"
for f in $(find "$REPO/web/src/app/api" -name "route.ts" ! -path "*/node_modules/*" 2>/dev/null | sort); do
  route=$(echo "$f" | sed "s|$REPO/web/src/app||" | sed 's|/route\.ts||')
  methods=$(grep "^export async function" "$f" 2>/dev/null | sed 's/export async function //' | sed 's/(.*//' | tr '\n' ', ' | sed 's/,$//')
  if [ -n "$methods" ]; then
    echo "- \`$route\` — $methods"
  else
    echo "- \`$route\`"
  fi
done

echo ""
echo "## Key Exports (web/src/lib/)"
for f in $(find "$REPO/web/src/lib" -name "*.ts" ! -path "*/node_modules/*" 2>/dev/null | sort); do
  exports=$(grep "^export " "$f" 2>/dev/null | head -15)
  if [ -n "$exports" ]; then
    shortpath=$(echo "$f" | sed "s|$REPO/||")
    echo ""
    echo "### $shortpath"
    echo '```typescript'
    echo "$exports"
    echo '```'
  fi
done

echo ""
echo "## Protocol Types"
for f in $(find "$REPO/protocol" -name "*.ts" ! -path "*/node_modules/*" 2>/dev/null | sort); do
  exports=$(grep "^export " "$f" 2>/dev/null | head -20)
  if [ -n "$exports" ]; then
    shortpath=$(echo "$f" | sed "s|$REPO/||")
    echo ""
    echo "### $shortpath"
    echo '```typescript'
    echo "$exports"
    echo '```'
  fi
done

echo ""
echo "## Components (web/src/)"
find "$REPO/web/src" -name "*.tsx" ! -path "*/node_modules/*" ! -path "*/.next/*" 2>/dev/null | sort | while read -r f; do
  shortpath=$(echo "$f" | sed "s|$REPO/||")
  # Extract default export or named component
  component=$(grep -E "^export (default function|function|const)" "$f" 2>/dev/null | head -3 | sed 's/export //' | sed 's/{.*//' | sed 's/(.*//')
  if [ -n "$component" ]; then
    echo "- \`$shortpath\` — $component"
  else
    echo "- \`$shortpath\`"
  fi
done

echo ""
echo "## CLI & Device Bridges"
for f in $(find "$REPO/cli" \( -name "*.mjs" -o -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*" 2>/dev/null | sort); do
  shortpath=$(echo "$f" | sed "s|$REPO/||")
  echo "- \`$shortpath\`"
done
for f in $(find "$REPO/desktop/src" -name "*.rs" 2>/dev/null | sort); do
  shortpath=$(echo "$f" | sed "s|$REPO/||")
  echo "- \`$shortpath\`"
done
