#!/usr/bin/env bash
# The soak (0302): ten minutes (or MINUTES) of the app looping its whole surface on a simulator, with no hands: a scored run on
# each course (the reference flown live), its replay, Home, a roam, Free Drive, and the next look each cycle
# (ColdGas/Debug/Soak.swift). Then scripts/soak-check.mjs says whether memory kept growing or anything was reported.
#
#   scripts/soak.sh [app]        default app: build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app (make build)
#   MINUTES=10 SIM_ID=<udid>     the simulator: default the project's own "ColdGas iPhone"
#
# This Mac's simulator rules: the shared lock /tmp/coldgas-sim.lock is held for the whole session (waits while another
# holds it), the app is copied to a temp dir before it's installed (a build elsewhere can't swap it mid-install), it's
# launched with -mute, and the simulator is shut down afterwards unless someone else holds the lock by then.
set -uo pipefail
cd "$(dirname "$0")/.."
APP=${1:-build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app}
MINUTES=${MINUTES:-10}
BID=com.mutaafaziz.coldgas
ID=${SIM_ID:-$(xcrun simctl list devices available | grep -F "    ColdGas iPhone (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')}
[ -n "$ID" ] || { echo "soak: no simulator named \"ColdGas iPhone\" (set SIM_ID)"; exit 64; }
[ -d "$APP" ] || { echo "soak: no app at $APP (make build)"; exit 64; }
LOCK=/tmp/coldgas-sim.lock
for _ in $(seq 1 720); do mkdir "$LOCK" 2>/dev/null && break; sleep 5; done
[ -d "$LOCK" ] || { echo "soak: the simulator lock stayed busy"; exit 75; }
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; rmdir "$LOCK" 2>/dev/null; [ -d "$LOCK" ] || xcrun simctl shutdown "$ID" 2>/dev/null; true; }
trap cleanup EXIT
cp -R "$APP" "$TMP/"
xcrun simctl boot "$ID" 2>/dev/null || true
xcrun simctl bootstatus "$ID" -b >/dev/null
xcrun simctl install "$ID" "$TMP/$(basename "$APP")" || { echo "soak: install failed"; exit 1; }
LOG=${LOG:-build/soak.log}
mkdir -p "$(dirname "$LOG")"
echo "soak: $MINUTES min on $ID, log $LOG"
xcrun simctl launch --console --terminate-running-process "$ID" "$BID" -mute -autopilot -soak "$MINUTES" > "$LOG" 2>&1 &
PID=$!
LIMIT=$(( MINUTES * 60 + 240 )); T=0
while [ $T -lt $LIMIT ]; do
  grep -q "^SOAK done" "$LOG" 2>/dev/null && break
  kill -0 $PID 2>/dev/null || break   # the app (and its console) went away: a crash
  sleep 5; T=$((T + 5))
done
xcrun simctl terminate "$ID" "$BID" 2>/dev/null; kill $PID 2>/dev/null; wait $PID 2>/dev/null
grep -E "^SOAK|^REPORT|^INJECT" "$LOG" | tail -40
node ../scripts/soak-check.mjs "$LOG"
