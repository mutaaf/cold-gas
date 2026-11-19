#!/usr/bin/env bash
# The perf matrix on the paired iPhone (0296, make device-bench-all): one Release build, then every look × scene, a fresh
# launch each with `-perf`, and the same table as the simulator's (scripts/perf-table.py). The owner runs it, on a phone of
# their choosing; it takes about 8 minutes, with sound (a Release build ignores -mute), and changes no setting (the look is a launch flag).
#   LOOKS="real" SCENES="show freedrive" make device-bench-all    a subset
#   BASE=build/perf/device-before.txt make device-bench-all      with each number's change against an earlier run
set -uo pipefail
cd "$(dirname "$0")/.."
UDID=${DEVICE_ID:-$(xcrun xctrace list devices 2>/dev/null | sed -n '/== Devices ==/,/== Devices Offline ==/p' | grep -E "iPhone|iPad" | grep -oE '\(([0-9A-Fa-f-]{25,})\)$' | tr -d '()' | head -1)}
[ -n "$UDID" ] || { echo "device-perf.sh: no iPhone connected and unlocked. Plug it in (or pair it over Wi-Fi in Xcode once)."; exit 1; }
DD=build/dd-device
xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration Release -destination "id=$UDID" -derivedDataPath $DD \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build || { echo "device-perf.sh: build/signing failed (team Z73865R687, Automatic)."; exit 1; }
APP=$DD/Build/Products/Release-iphoneos/ColdGas.app
xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null || { echo "device-perf.sh: install failed. On the phone: Settings → General → VPN & Device Management → trust the developer."; exit 1; }
LOOKS=${LOOKS:-real anime pixel}
SCENES=${SCENES:-title show wall lineup roam freedrive cycle sheet paused}
SECS=${PERF_SECS:-8}
OUT=${OUT:-build/perf/device-$(date +%Y%m%d-%H%M%S).txt}
mkdir -p "$(dirname "$OUT")"; : > "$OUT"
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
for look in $LOOKS; do
  for scene in $SCENES; do
    case $scene in cycle|sheet|paused) [ "$look" != real ] && continue ;; esac   # memory after Free Drive, a sheet, a pause: one look
    # shellcheck disable=SC2046
    line=$(xcrun devicectl device process launch --console --terminate-existing --device "$UDID" com.mutaafaziz.coldgas -- \
      -look "$look" -perf "$SECS" -perf-scene "$scene" $(scene_args "$scene") 2>&1 | grep -m1 '^PERF ')
    [ -n "$line" ] || line="PERF scene=$scene look=$look failed=1"
    echo "$line" | tee -a "$OUT"
  done
done
echo
if [ -n "${BASE:-}" ]; then python3 -I scripts/perf-table.py "$OUT" --base "$BASE"; else python3 -I scripts/perf-table.py "$OUT"; fi
echo "(saved: ios/$OUT)"
