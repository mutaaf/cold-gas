#!/usr/bin/env bash
# Each look on each course at the same moments, for a before/after check of a render change (0297, docs/PERF-2026-11-18.md).
#   scripts/perf-shots.sh <ColdGas.app> <outdir> <prefix>     → <outdir>/<prefix>-<look>-<course>-<t>.jpg (half size)
#   scripts/imgdiff.swift a.jpg b.jpg                          → the mean difference and the share of pixels that moved
# A recorded run (`-replay ref-<course>`) held at sim times (`-holds`), the render scale pinned (`-scale 0.8`) so the
# governor can't change it between runs. The clock stops within a frame of each hold, so a car in flight can sit a
# few centimetres apart between two runs; the set, the light and the look are what to compare.
# The "ColdGas iPhone" simulator only (SIM_ID overrides), under /tmp/coldgas-sim.lock, a private copy of the .app, -mute.
set -uo pipefail
cd "$(dirname "$0")/.."
APP=${1:?usage: perf-shots.sh <ColdGas.app> <outdir> <prefix>} OUT=${2:?outdir} PRE=${3:?prefix}
ID=${SIM_ID:-6E7C465E-A279-41A4-A94D-494D1576EC48} BID=com.mutaafaziz.coldgas
LOOKS=${LOOKS:-real anime pixel} COURSES=${COURSES:-show wall lineup} HOLDS=${HOLDS:-2.5,5.5}
LOCK=/tmp/coldgas-sim.lock
mkdir -p "$OUT"
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
# PERF_LOCKED=1: the caller holds the lock (several runs in one session) and shuts the simulator down itself.
if [ -z "${PERF_LOCKED:-}" ]; then
  until mkdir "$LOCK" 2>/dev/null; do echo "perf-shots.sh: waiting for $LOCK"; sleep 10; done
  trap 'rmdir "$LOCK" 2>/dev/null; [ -d "$LOCK" ] || xcrun simctl shutdown "$ID" 2>/dev/null; true' EXIT
fi
COPY=$(mktemp -d)/ColdGas.app
cp -R "$APP" "$COPY"
xcrun simctl boot "$ID" 2>/dev/null || true
t 240 xcrun simctl bootstatus "$ID" -b >/dev/null
t 180 xcrun simctl install "$ID" "$COPY"
for look in $LOOKS; do
  for c in $COURSES; do
    xcrun simctl terminate "$ID" $BID 2>/dev/null || true
    d=$(xcrun simctl get_app_container "$ID" $BID data)
    rm -f "$d/Library/Caches/coldgas.ready" "$d/Library/Caches/coldgas.go"
    t 20 xcrun simctl launch "$ID" $BID -mute -replay "ref-$c" -holds "$HOLDS" -scale 0.8 -fps 60 -look "$look" >/dev/null
    for h in ${HOLDS//,/ }; do
      for _ in $(seq 1 240); do grep -q "hold:$h" "$d/Library/Caches/coldgas.ready" 2>/dev/null && break; sleep 0.5; done
      sleep 1.5   # a few frames at the hold: the effects settle on the frozen clock
      png="$OUT/.$PRE-$look-$c-$h.png"
      t 30 xcrun simctl io "$ID" screenshot --display=primary "$png" >/dev/null 2>&1
      sips -s format jpeg -s formatOptions 82 -Z 1311 "$png" --out "$OUT/$PRE-$look-$c-$h.jpg" >/dev/null && rm -f "$png" && echo "$PRE-$look-$c-$h"
      touch "$d/Library/Caches/coldgas.go"
    done
  done
done
xcrun simctl terminate "$ID" $BID 2>/dev/null || true
rm -rf "$(dirname "$COPY")"
