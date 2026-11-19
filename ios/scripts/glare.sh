#!/usr/bin/env bash
# The glare gate (0291): the first seconds of the Show, the Wall and the Lineup runs, measured by the `-luma` probe
# (ColdGas/Debug/LumaProbe.swift, Debug builds), and failed if a run's opening blinds:
#   white97   the share of the frame at luma ≥ 247 (0.97 of white)             ≤ $MAX_WHITE  (default 0.5 %) in every frame
#   car hot   the share of the car's pixels with every channel ≥ 235          ≤ $MAX_CARHOT (default 0.5 %) in every frame
#   carFloor  the car's 10th-percentile luma: a haze over the car lifts it    ≤ $MAX_FLOOR  (default 60)    in every frame
# One simulator ($SIM_ID, default the first "ColdGas iPhone"), launched muted; it waits for /tmp/coldgas-sim.lock (shared by
# every agent on this Mac) and shuts the simulator down after. Snapshots and logs → $OUT (default build/glare).
#   scripts/glare.sh [app path]        (make glare)
set -uo pipefail
cd "$(dirname "$0")/.."
APP=${1:-build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app} BID=com.mutaafaziz.coldgas
OUT=${OUT:-build/glare} SECS=${SECS:-22} UNTIL=${UNTIL:-3.0}
MAX_WHITE=${MAX_WHITE:-0.5} MAX_CARHOT=${MAX_CARHOT:-0.5} MAX_FLOOR=${MAX_FLOOR:-60}
ID=${SIM_ID:-$(xcrun simctl list devices available | grep -F "    ColdGas iPhone (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')}
[ -n "$ID" ] || { echo "no simulator named ColdGas iPhone"; exit 2; }
mkdir -p "$OUT"
until mkdir /tmp/coldgas-sim.lock 2>/dev/null; do echo "glare: waiting for the simulator lock"; sleep 10; done
trap 'xcrun simctl terminate "$ID" $BID 2>/dev/null; xcrun simctl shutdown "$ID" 2>/dev/null; rmdir /tmp/coldgas-sim.lock' EXIT
xcrun simctl boot "$ID" 2>/dev/null; xcrun simctl bootstatus "$ID" -b >/dev/null
xcrun simctl install "$ID" "$APP" || exit 2
DATA=$(xcrun simctl get_app_container "$ID" $BID data)
fail=0
for c in show wall lineup; do
  rm -rf "$DATA/Library/Caches/luma"
  # A quarter-speed clock: 3 s of the run's opening over ≈ 12 s, measured every 4th frame and snapped at three moments.
  ( xcrun simctl launch --console --terminate-running-process "$ID" $BID -mute -play -course $c -autopilot -timescale 0.25 \
      -luma $c -luma-every 4 -luma-snap 0.3,1.5,3.0 > "$OUT/$c.log" 2>&1 ) &
  p=$!; sleep "$SECS"; kill $p 2>/dev/null; xcrun simctl terminate "$ID" $BID 2>/dev/null
  for f in "$DATA"/Library/Caches/luma/*.png; do [ -f "$f" ] && cp "$f" "$OUT/$(basename "$f" | tr -d '#')"; done
  # LUMA <tag> t <t> car <clip> hot <hot> … white97 <w> carFloor <f>
  awk -v c=$c -v until=$UNTIL -v mw=$MAX_WHITE -v mh=$MAX_CARHOT -v mf=$MAX_FLOOR '
    $1 == "LUMA" && $4 <= until {
      for (i = 1; i < NF; i++) v[$i] = $(i + 1)
      n++; if (v["white97"] > w) w = v["white97"]; if ($8 > h) h = $8; if (v["carFloor"] > f) f = v["carFloor"]
    }
    END {
      bad = n == 0 || w > mw || h > mh || f > mf
      printf "glare %-6s %s  frames %d  white97 max %.3f %% (≤ %s)  car hot max %.2f %% (≤ %s)  carFloor max %d (≤ %s)\n", c, bad ? "FAIL" : "ok  ", n, w, mw, h, mh, f, mf
      exit bad
    }' "$OUT/$c.log" || fail=1
done
exit $fail
