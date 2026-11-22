#!/usr/bin/env bash
# Put an earlier working version back on Embarko, without a rebuild (https://embarko.ai/docs/rollback.md).
#   scripts/embarko-rollback.sh <app-name>                 list the deployments (newest first); changes nothing
#   scripts/embarko-rollback.sh <app-name> previous        roll back to the most recent good deploy before the current one
#   scripts/embarko-rollback.sh <app-name> <deploymentId>  roll back to that deploy (pick it from the list)
# Token: $DEPLOY_TOKEN, else line 1 of ~/.embarko/credentials. It is never printed.
#
# What a rollback does and does NOT do (Embarko's rules):
#   - it keeps today's environment variables, domains and schedule;
#   - DATA_DIR (the SQLite database) is NOT rolled back: the older code runs against today's data. Zentro's older
#     code starts anyway (it only logs "database is newer than this code"), but features added after that version
#     (and their tables) are unused until a fixed version is deployed;
#   - Embarko keeps only the last 5 builds, so an older version cannot be restored.
set -euo pipefail

APP="${1:?usage: $0 <app-name> [previous|<deploymentId>]}"
TARGET="${2:-}"
API="https://ship.embarko.ai"
TOKEN="${DEPLOY_TOKEN:-$(head -1 "$HOME/.embarko/credentials" 2>/dev/null || true)}"
[ -n "$TOKEN" ] || { echo "No token: set DEPLOY_TOKEN or put it on line 1 of ~/.embarko/credentials" >&2; exit 1; }

# The token goes to curl on stdin, so it never appears in the process list.
ecurl() { printf 'oauth2-bearer = "%s"\n' "$TOKEN" | curl -sS -K - "$@"; }

LIST="$(ecurl -m 30 "$API/api/apps/$APP/deployments")"
echo "$LIST" | python3 -c '
import sys, json
d = json.load(sys.stdin)
items = d.get("deployments", [])
if not items:
    sys.exit("No deployments found (wrong app name, or the token cannot see this app).")
print("%-26s %-5s %-8s %-26s %s" % ("deploymentId", "ver", "status", "created", "can roll back to"))
for x in items:
    print("%-26s %-5s %-8s %-26s %s" % (x.get("id"), x.get("version"), x.get("status"), x.get("createdAt"), "yes" if x.get("rollbackTarget") else "no (current, failed or too old)"))
'

[ -n "$TARGET" ] || { echo; echo "Nothing changed. To roll back: $0 $APP previous   (or pass a deploymentId from the list)"; exit 0; }

if [ "$TARGET" = "previous" ]; then BODY='{}'; else
  case "$TARGET" in *[!A-Za-z0-9_-]*) echo "Not a valid deploymentId." >&2; exit 1 ;; esac
  BODY="{\"deploymentId\":\"$TARGET\"}"
fi
[ "${DRY_RUN:-}" = 1 ] && { echo "DRY_RUN: would POST $BODY to $API/api/apps/$APP/rollback. Nothing changed."; exit 0; }

echo "Rolling $APP back ($TARGET) ..."
R="$(printf '%s' "$BODY" | ecurl -m 60 -w '\nHTTP %{http_code}\n' -X POST "$API/api/apps/$APP/rollback" -H 'X-Agent-Name: claude-code' -H 'Content-Type: application/json' --data @- 2>&1 || true)"
echo "$R"
STATUS_URL="$(echo "$R" | grep -o '"statusUrl":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
[ -n "$STATUS_URL" ] || { echo "Embarko did not accept the rollback (see the reply above). Nothing was changed." >&2; exit 1; }

for _ in $(seq 1 60); do
  S="$(ecurl -m 20 "$API$STATUS_URL" || true)"
  if echo "$S" | grep -q '"terminal":true'; then echo "$S"; break; fi
  sleep 5
done
echo "--- the live site now reports:"
curl -sS -m 20 "https://$APP.embarko.app/healthz" || true; echo
