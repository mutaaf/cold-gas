#!/usr/bin/env bash
# Screenshots of the spike (docs/NATIVE.md §8): the iPhone Duo's outer screen as it boots (closed), the book and
# tabletop poses laid out with -window (the simulator can't move its hinge: moon-club), and the Pro Max.
# The inner display ("primary-1") is captured too when the Duo has been unfolded in Device Hub.
#   scripts/shots.sh [outdir]
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-build/shots}; mkdir -p "$OUT"
APP=build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app BID=com.mutaafaziz.coldgas
id_of() { xcrun simctl list devices available | grep -F "    $1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
ready() { # <sim> <token>: wait for the app's readiness file instead of sleeping
  local d; d=$(xcrun simctl get_app_container "$1" $BID data 2>/dev/null)
  for _ in $(seq 1 60); do grep -q "$2" "$d/Library/Caches/coldgas.ready" 2>/dev/null && break; sleep 0.5; done
  sleep "${SETTLE:-2}"
}
shoot() { # <sim> <name> [args…]
  local id=$1 name=$2; shift 2
  xcrun simctl terminate "$id" $BID 2>/dev/null || true
  local d; d=$(xcrun simctl get_app_container "$id" $BID data 2>/dev/null) && rm -f "$d/Library/Caches/coldgas.ready"
  t 30 xcrun simctl launch "$id" $BID "$@" >/dev/null
  ready "$id" frame
  t 30 xcrun simctl io "$id" screenshot --display=primary "$OUT/$name.png" >/dev/null 2>&1
}
for DEV in "iPhone Duo" "iPhone 18 Pro Max"; do
  ID=$(id_of "$DEV"); [ -n "$ID" ] || { echo "no simulator $DEV"; continue; }
  xcrun simctl boot "$ID" 2>/dev/null || true
  t 240 xcrun simctl bootstatus "$ID" -b >/dev/null
  xcrun simctl status_bar "$ID" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null || true
  t 180 xcrun simctl install "$ID" "$APP"
  TAG=$(echo "$DEV" | tr ' ' '_')
  shoot "$ID" "$TAG"
  if [ "$DEV" = "iPhone Duo" ]; then
    shoot "$ID" "${TAG}-book" -window 951x669 -pose book
    shoot "$ID" "${TAG}-tabletop" -window 669x951 -pose tabletop
    t 20 xcrun simctl io "$ID" screenshot --display=primary-1 "$OUT/${TAG}-inner.png" >/dev/null 2>&1
    # Drop the inner shot when the device is closed (its framebuffer is all black): shrink it to 16 px and read the brightest byte.
    if [ -f "$OUT/${TAG}-inner.png" ]; then
      sips -Z 16 -s format bmp "$OUT/${TAG}-inner.png" --out /tmp/coldgas-inner.bmp >/dev/null 2>&1
      python3 -c "import sys;d=open('/tmp/coldgas-inner.bmp','rb').read()[54:];sys.exit(0 if max(d or b'\0')>12 else 1)" || rm -f "$OUT/${TAG}-inner.png"
    fi
  fi
done
ls -1 "$OUT"
