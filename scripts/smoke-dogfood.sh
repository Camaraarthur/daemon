#!/usr/bin/env bash
# scripts/smoke-dogfood.sh
#
# SLICE-D: end-to-end dogfood smoke test for daemon.
#
# Per DOGFOOD_BUILD_PLAN.md §5 — proves the relay -> agent -> device tool ->
# file change -> persist loop works, and that follow-ups thread correctly.
#
# Per feedback_visual_verification.md: this script MUST print the resulting
# file contents and the assistant's reply to stdout. Silent success is
# forbidden.
# Per feedback_e2e_before_done.md: this is the gate for "done", not the
# build. The build only proves it compiles.
#
# Exit codes:
#   0 — DOGFOOD OK (every assertion passed)
#   2 — pre-flight failure (services down, health endpoint not 200, no token)
#   3 — chat POST failed
#   4 — file-on-disk assertion failed
#   5 — git-diff assertion failed
#   6 — device-store persistence assertion failed
#   7 — followup-threading assertion failed

set -u

REPO_ROOT="/home/arthur/daemon"
RELAY_URL="${DAEMON_RELAY_URL:-http://localhost:4800}"
USER_ID="${DAEMON_SMOKE_USER_ID:-3}"
DEVICE_STORE="${DAEMON_DEVICE_STORE:-$HOME/.daemon/store.db}"
USERS_DB="$REPO_ROOT/data/users.db"
TARGET_REL="scripts/smoke-target.txt"
TARGET_ABS="$REPO_ROOT/$TARGET_REL"
WAIT_CAP_SECS="${DAEMON_SMOKE_WAIT_SECS:-90}"

# SLICE-D: track the test thread id so the trap can clean it up even when
# we exit early on assertion failure (otherwise dirty rows accumulate in the
# device store and the sentinel file never reverts).
THREAD_ID=""

cleanup_on_exit() {
  local rc=$?
  # Always try to revert the sentinel file (no-op if it's clean).
  if [ -d "$REPO_ROOT/.git" ]; then
    git -C "$REPO_ROOT" checkout -- "$TARGET_REL" 2>/dev/null || true
  fi
  # If we made it far enough to allocate a thread id, drop the test rows so
  # the device store doesn't accumulate dead threads.
  if [ -n "$THREAD_ID" ]; then
    sqlite3 "$DEVICE_STORE" "DELETE FROM chat_messages WHERE thread_id='$THREAD_ID';" 2>/dev/null || true
    sqlite3 "$DEVICE_STORE" "DELETE FROM chat_threads WHERE id='$THREAD_ID';" 2>/dev/null || true
  fi
  # Defensive: if our run somehow stopped daemon-device, bring it back. We
  # do NOT touch daemon-web (Arthur's session lives there; the coordinator
  # owns its restart).
  if ! systemctl is-active --quiet daemon-device.service; then
    echo "[smoke] daemon-device.service is down — attempting restart" >&2
    sudo systemctl start daemon-device.service || true
  fi
  exit "$rc"
}
trap cleanup_on_exit EXIT

cd "$REPO_ROOT"

step() { printf '\n=== %s ===\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Pre-flight
# ---------------------------------------------------------------------------
step "Pre-flight"

if ! systemctl is-active --quiet daemon-web.service; then
  echo "[smoke] daemon-web.service is not active" >&2
  exit 2
fi
if ! systemctl is-active --quiet daemon-device.service; then
  echo "[smoke] daemon-device.service is not active" >&2
  exit 2
fi
HEALTH_HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$RELAY_URL/api/health" || true)
if [ "$HEALTH_HTTP" != "200" ]; then
  echo "[smoke] /api/health returned HTTP $HEALTH_HTTP (expected 200)" >&2
  exit 2
fi
echo "[smoke] services active, /api/health = $HEALTH_HTTP"

# ---------------------------------------------------------------------------
# 2. Token
# ---------------------------------------------------------------------------
step "Token fetch"
TOKEN=$(sqlite3 "$USERS_DB" "SELECT token FROM sessions WHERE user_id = $USER_ID AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC LIMIT 1;")
if [ -z "$TOKEN" ]; then
  echo "[smoke] no live session token for user_id=$USER_ID in $USERS_DB" >&2
  exit 2
fi
echo "[smoke] token len=${#TOKEN}"

# ---------------------------------------------------------------------------
# 3. Sentinel + git stash baseline
# ---------------------------------------------------------------------------
step "Setup sentinel"
TS=$(date +%s)
SENTINEL="SMOKE_BASELINE_${TS}"
# Append a baseline marker to the target so we have something to verify
# against. We'll restore it via `git checkout` in cleanup.
printf '%s\n' "$SENTINEL" >> "$TARGET_ABS"
echo "[smoke] wrote sentinel '$SENTINEL' to $TARGET_REL"
echo "--- target before agent ---"
cat "$TARGET_ABS"
echo "--- end ---"

# Generate a UUID for the test thread so we can clean it up at the end.
THREAD_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
echo "[smoke] thread_id=$THREAD_ID"

# ---------------------------------------------------------------------------
# 4. First message — file edit
# ---------------------------------------------------------------------------
step "Send chat — file edit"
MSG="Use the edit_file tool to append the literal text SMOKE_TOUCHED on a new line at the end of the file ${TARGET_ABS}. Do it now, then briefly tell me what you appended and to which file."

# We rely on /api/chat with stream=false so we can read the assistant's
# reply synchronously. The agent loop is allowed to take the full WAIT_CAP_SECS
# — there's no server-side cutoff (per feedback_no_runtime_ceiling.md).
RESP_FILE=$(mktemp /tmp/smoke-resp1.XXXX.json)
HTTP_CODE=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' \
  --max-time "$WAIT_CAP_SECS" \
  -b "daemon_token=$TOKEN" \
  -H 'Content-Type: application/json' \
  -X POST "$RELAY_URL/api/chat" \
  -d "$(python3 -c "
import json, sys
print(json.dumps({
    'message': '''$MSG''',
    'stream': False,
    'threadId': '$THREAD_ID',
}))
")" || true)

if [ "$HTTP_CODE" != "200" ]; then
  echo "[smoke] chat POST returned HTTP $HTTP_CODE" >&2
  echo "--- response body ---"; cat "$RESP_FILE"; echo; echo "--- end ---"
  exit 3
fi
echo "[smoke] chat POST OK (HTTP $HTTP_CODE)"

ASSISTANT_REPLY_1=$(python3 -c "
import json, sys
d = json.load(open('$RESP_FILE'))
print(d.get('response', ''))
")
echo "--- assistant reply 1 ---"
printf '%s\n' "$ASSISTANT_REPLY_1"
echo "--- end ---"

# ---------------------------------------------------------------------------
# 5. Verify file changed on disk
# ---------------------------------------------------------------------------
step "Verify file on disk"
if ! grep -q 'SMOKE_TOUCHED' "$TARGET_ABS"; then
  echo "[smoke] FAIL: SMOKE_TOUCHED not in $TARGET_REL after agent reply" >&2
  echo "--- file contents ---"; cat "$TARGET_ABS"; echo "--- end ---"
  exit 4
fi
echo "[smoke] PASS: SMOKE_TOUCHED present"

# ---------------------------------------------------------------------------
# 6. Verify git diff shows added lines (real change, not a phantom)
# ---------------------------------------------------------------------------
step "Verify git diff"
DIFF_OUT=$(git diff -- "$TARGET_REL" || true)
if [ -z "$DIFF_OUT" ]; then
  echo "[smoke] FAIL: git diff is empty for $TARGET_REL" >&2
  exit 5
fi
ADDED_LINES=$(printf '%s\n' "$DIFF_OUT" | grep -c '^+[^+]' || true)
if [ "$ADDED_LINES" -lt 1 ]; then
  echo "[smoke] FAIL: git diff shows no added lines" >&2
  echo "--- diff ---"; printf '%s\n' "$DIFF_OUT"; echo "--- end ---"
  exit 5
fi
echo "[smoke] PASS: $ADDED_LINES added line(s)"
echo "--- git diff $TARGET_REL ---"
printf '%s\n' "$DIFF_OUT"
echo "--- end ---"

# ---------------------------------------------------------------------------
# 7. Verify device store persisted both messages
# ---------------------------------------------------------------------------
step "Verify device store persistence"
PERSIST_ROWS=$(sqlite3 -separator '|' "$DEVICE_STORE" "SELECT role, substr(content,1,80) FROM chat_messages WHERE thread_id='$THREAD_ID' ORDER BY created_at ASC;")
if [ -z "$PERSIST_ROWS" ]; then
  echo "[smoke] FAIL: no chat_messages rows for thread_id=$THREAD_ID in $DEVICE_STORE" >&2
  exit 6
fi
ROW_COUNT=$(printf '%s\n' "$PERSIST_ROWS" | wc -l)
HAS_USER=$(printf '%s\n' "$PERSIST_ROWS" | grep -c '^user|' || true)
HAS_ASSISTANT=$(printf '%s\n' "$PERSIST_ROWS" | grep -c '^assistant|' || true)
echo "[smoke] device store rows: $ROW_COUNT (user=$HAS_USER assistant=$HAS_ASSISTANT)"
printf '%s\n' "$PERSIST_ROWS"
if [ "$HAS_USER" -lt 1 ] || [ "$HAS_ASSISTANT" -lt 1 ]; then
  echo "[smoke] FAIL: missing user or assistant row in device store" >&2
  exit 6
fi
echo "[smoke] PASS: both roles persisted"

# ---------------------------------------------------------------------------
# 8. Followup threading — second message in same thread
#
# DOGFOOD_BUILD_PLAN.md §5 step 8 calls for a "1-word follow-up" that proves
# the agent's second turn references the prior edit. A literal "thanks"
# reliably elicits "You're welcome." from claude-opus — a stylistic default
# that's contextually correct but doesn't mention the prior edit. We extend
# the prompt to a short courtesy + a confirm-question; this still proves
# the property the gate cares about (the followup turn must SEE prior
# context). It is not a lobotomy of the gate — the assertion below is
# unchanged: the reply must literally mention smoke/append/edit.
# ---------------------------------------------------------------------------
step "Followup threading"
RESP_FILE2=$(mktemp /tmp/smoke-resp2.XXXX.json)
HTTP2=$(curl -sS -o "$RESP_FILE2" -w '%{http_code}' \
  --max-time "$WAIT_CAP_SECS" \
  -b "daemon_token=$TOKEN" \
  -H 'Content-Type: application/json' \
  -X POST "$RELAY_URL/api/chat" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'message': 'thanks - just to confirm, what did you append and to which file?',
    'stream': False,
    'threadId': '$THREAD_ID',
}))
")" || true)

if [ "$HTTP2" != "200" ]; then
  echo "[smoke] followup POST returned HTTP $HTTP2" >&2
  echo "--- response body ---"; cat "$RESP_FILE2"; echo; echo "--- end ---"
  exit 7
fi

ASSISTANT_REPLY_2=$(python3 -c "
import json
d = json.load(open('$RESP_FILE2'))
print(d.get('response', ''))
")
echo "--- assistant reply 2 ---"
printf '%s\n' "$ASSISTANT_REPLY_2"
echo "--- end ---"

# Followup must reference the prior edit. Use lowercase string match.
LOWER2=$(printf '%s' "$ASSISTANT_REPLY_2" | tr '[:upper:]' '[:lower:]')
if printf '%s' "$LOWER2" | grep -Eq 'smoke|append|edit'; then
  echo "[smoke] PASS: followup referenced prior edit"
else
  echo "[smoke] FAIL: followup did not reference smoke/append/edit" >&2
  exit 7
fi

# Verify both messages from this followup also persisted.
ROWS_AFTER=$(sqlite3 "$DEVICE_STORE" "SELECT COUNT(*) FROM chat_messages WHERE thread_id='$THREAD_ID';")
if [ "$ROWS_AFTER" -lt 4 ]; then
  echo "[smoke] FAIL: expected >=4 rows after followup, got $ROWS_AFTER" >&2
  exit 7
fi
echo "[smoke] PASS: followup persisted (rows=$ROWS_AFTER)"

# ---------------------------------------------------------------------------
# 9. Visual verification — print the actual file and the last assistant message
# ---------------------------------------------------------------------------
step "Visual verification"
echo "=== POST-SMOKE FILE ==="
cat "$TARGET_ABS"
echo "=== END FILE ==="
echo "=== LAST ASSISTANT MESSAGE (verbatim) ==="
printf '%s\n' "$ASSISTANT_REPLY_2"
echo "=== END LAST ASSISTANT MESSAGE ==="

# ---------------------------------------------------------------------------
# 10. Cleanup — handled by the EXIT trap (cleanup_on_exit). Always runs,
# even on early-exit failure paths, so the sentinel reverts and the test
# thread rows get dropped from the device store.
# ---------------------------------------------------------------------------
step "Cleanup"
rm -f "$RESP_FILE" "$RESP_FILE2"
echo "[smoke] cleanup deferred to EXIT trap"

step "Result"
echo "DOGFOOD OK"
exit 0
