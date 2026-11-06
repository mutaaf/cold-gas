#!/usr/bin/env bash
# Boot a simulator by name, install the app, launch it with arguments and print its console for a while.
#   scripts/sim.sh "<simulator name>" <app path> <bundle id> [launch args…]
# Every simctl call gets a timeout: fresh runtimes hang on `simctl launch` (moon-club). Names repeat across
# runtimes, so the first available match's UDID is used (or SIM_ID).
set -uo pipefail
NAME=$1 APP=$2 BID=$3; shift 3
ID=${SIM_ID:-$(xcrun simctl list devices available | grep -F "    $NAME (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')}
[ -n "$ID" ] || { echo "no simulator named $NAME"; exit 1; }
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; local rc=$?; kill $w 2>/dev/null; return $rc; }
xcrun simctl boot "$ID" 2>/dev/null || true
t 240 xcrun simctl bootstatus "$ID" -b >/dev/null
t 180 xcrun simctl install "$ID" "$APP"
xcrun simctl terminate "$ID" "$BID" 2>/dev/null || true
SECS=${SECS:-$([[ " $* " == *" -bench "* ]] && echo 25 || echo 12)}
# --console prints the app's stdout (--console-pty printed nothing: moon-club).
t "$SECS" xcrun simctl launch --console --terminate-running-process "$ID" "$BID" "$@" 2>&1 | grep -E "^(READY|LAYOUT|BENCH|SELFTEST|PIPELINES|RENDERER)" || true
