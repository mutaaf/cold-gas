#!/usr/bin/env bash
# The perf matrix (0296, docs/PERF-2026-11-18.md): every look × every scene, each a fresh launch with `-perf`, one PERF line
# each, then the table (scripts/perf-table.py).
#   scripts/perf.sh <ColdGas.app> [out.txt]       on the simulator (make perf)
#   LOOKS="real" SCENES="title show" …            a subset
#   REPEAT=3                                      each cell that many times (the table keeps the median)
# The simulator is "ColdGas iPhone" (SIM_ID overrides); it's shared with other sessions, so the run holds
# /tmp/coldgas-sim.lock, installs a private copy of the .app, launches with -mute and shuts the simulator down after.
# The simulator's GPU timings say nothing about a phone's: read CPU, draws, passes and memory here, GPU on a phone
# (scripts/device-perf.sh, make device-bench-all).
set -uo pipefail
cd "$(dirname "$0")/.."
APP=${1:?usage: perf.sh <ColdGas.app> [out.txt]}
OUT=${2:-build/perf/perf-$(date +%Y%m%d-%H%M%S).txt}
ID=${SIM_ID:-6E7C465E-A279-41A4-A94D-494D1576EC48}
BID=com.mutaafaziz.coldgas
LOOKS=${LOOKS:-real anime pixel}
SCENES=${SCENES:-title show wall lineup roam freedrive cycle sheet paused}
REPEAT=${REPEAT:-1}
SECS=${PERF_SECS:-8}
LOCK=/tmp/coldgas-sim.lock
mkdir -p "$(dirname "$OUT")"
: > "$OUT"
scene_args() {
  case $1 in
    title)     echo "-course show -perf-wait 3" ;;
    show)      echo "-course show -play -autopilot -perf-wait 4" ;;
    wall)      echo "-course wall -play -autopilot -perf-wait 4" ;;
    lineup)    echo "-course lineup -play -autopilot -perf-wait 4" ;;
    roam)      echo "-roam show -fd-pilot 12 -perf-wait 6" ;;
    freedrive) echo "-freedrive -fd-km 3 -fd-pilot 25 -perf-wait 10" ;;
    cycle)     echo "-course show -perf-cycle 3 -perf-wait 28" ;;   # Free Drive in and out three times, then the title
    sheet)     echo "-course show -perf-sheet settings -perf-wait 4" ;;   # Settings open over the title
    paused)    echo "-course show -play -autopilot -perf-pause 4 -perf-wait 6" ;;   # a run paused
  esac
}
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; local rc=$?; kill $w 2>/dev/null; return $rc; }

# PERF_LOCKED=1: the caller holds the lock (several runs in one session) and shuts the simulator down itself.
if [ -z "${PERF_LOCKED:-}" ]; then
  until mkdir "$LOCK" 2>/dev/null; do echo "perf.sh: waiting for $LOCK"; sleep 10; done
  trap 'rmdir "$LOCK" 2>/dev/null; [ -d "$LOCK" ] || xcrun simctl shutdown "$ID" 2>/dev/null; true' EXIT
fi
COPY=$(mktemp -d)/ColdGas.app
cp -R "$APP" "$COPY"
xcrun simctl boot "$ID" 2>/dev/null || true
t 240 xcrun simctl bootstatus "$ID" -b >/dev/null
t 180 xcrun simctl install "$ID" "$COPY"
for look in $LOOKS; do
  for scene in $SCENES; do
    case $scene in cycle|sheet|paused) [ "$look" != real ] && continue ;; esac   # memory after Free Drive, a sheet, a pause: one look
    for ((i = 1; i <= REPEAT; i++)); do
      xcrun simctl terminate "$ID" "$BID" 2>/dev/null || true
      # shellcheck disable=SC2046
      line=$(t $((SECS + 60)) xcrun simctl launch --console --terminate-running-process "$ID" "$BID" -mute -look "$look" \
        -perf "$SECS" -perf-scene "$scene" $(scene_args "$scene") 2>&1 | grep -m1 '^PERF ')
      [ -n "$line" ] || line="PERF scene=$scene look=$look failed=1"
      echo "$line" | tee -a "$OUT"
    done
  done
done
xcrun simctl terminate "$ID" "$BID" 2>/dev/null || true
rm -rf "$(dirname "$COPY")"
python3 -I scripts/perf-table.py "$OUT"
