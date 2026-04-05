#!/bin/bash
# Test chat quality with diverse prompts against the running daemon server
# Requires: server running on localhost:4800, valid session in data/users.db

set -euo pipefail

DB="/home/arthur/daemon/data/users.db"
BASE="http://localhost:4800/api/chat"

# Get a valid token
TOKEN=$(sqlite3 "$DB" "SELECT token FROM sessions WHERE user_id = 3 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "ERROR: No valid session token found. Is the server running with a logged-in user?"
  exit 1
fi

PASS=0
FAIL=0
TOTAL=0

test_prompt() {
  local prompt="$1"
  local expect="$2"
  TOTAL=$((TOTAL+1))

  local response
  response=$(curl -s --max-time 30 -X POST "$BASE" \
    -b "daemon_token=$TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"$prompt\",\"stream\":false}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response','') or d.get('content','') or d.get('error','NO_RESPONSE'))" 2>/dev/null || echo "CURL_ERROR")

  local short="${response:0:120}"
  if echo "$response" | grep -qi "$expect"; then
    echo "  PASS: \"$prompt\" -> contains '$expect'"
    PASS=$((PASS+1))
  else
    echo "  FAIL: \"$prompt\" -> expected '$expect', got: $short"
    FAIL=$((FAIL+1))
  fi
}

echo "=== Daemon Chat Quality Tests ==="
echo "Token: ${TOKEN:0:8}..."
echo ""

test_prompt "What is 2+2?" "4"
test_prompt "Write hello world in Python" "print"
test_prompt "What language is this: console.log('hello')" "javascript"
test_prompt "Fix this code: def add(a, b) return a + b" "def"
test_prompt "What does git status do?" "working\|staged\|modified\|git"

echo ""
echo "Results: $PASS passed, $FAIL failed out of $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
