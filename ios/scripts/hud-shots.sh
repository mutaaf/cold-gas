#!/usr/bin/env bash
# The HUD layout editor and two custom layouts (0220) on a phone held sideways, the Duo in tabletop and an iPad, all on ONE
# simulator: the Duo and the iPad are laid out by -window (+ -pose), as deck-shots.sh does. Each shot waits for a readiness
# token (the editor's "hud-editor", a frozen run's "frozen"), never a fixed sleep.
#   scripts/hud-shots.sh [outdir]      (after `make build`; SIM names the simulator, ONLY="wide-editor ..." picks shots)
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-build/hud-shots}; mkdir -p "$OUT"
APP=build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app BID=com.mutaafaziz.coldgas
SIM=${SIM-ColdGas HUD}
id_of() { xcrun simctl list devices available | grep -F "    $1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
readyfiles() { ls "$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Containers/Data/Application/"*/Library/Caches/coldgas.ready 2>/dev/null; }
ready() { # <sim> <token>
  for _ in $(seq 1 ${READY_TRIES:-600}); do readyfiles "$1" | while read -r f; do grep -q "$2" "$f" && echo y; done | grep -q y && return 0; sleep 0.5; done
  echo "timed out waiting for $2" >&2; return 1
}
shoot() { # <sim> <name> <token> [launch args…]
  local id=$1 name=$2 token=$3; shift 3
  [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $name "* ]] || return 0
  t 20 xcrun simctl terminate "$id" $BID 2>/dev/null || true
  readyfiles "$id" | while read -r f; do rm -f "$f"; done
  t 30 xcrun simctl launch "$id" $BID -uitest "$@" >/dev/null
  ready "$id" "$token" && sleep "${SETTLE:-2}"
  t 30 xcrun simctl io "$id" screenshot --display=primary "$OUT/$name.png" >/dev/null 2>&1 && echo "$OUT/$name.png"
}
id=$(id_of "$SIM"); [ -n "$id" ] || { echo "no simulator $SIM" >&2; exit 1; }
xcrun simctl boot "$id" 2>/dev/null || true
t 300 xcrun simctl bootstatus "$id" -b >/dev/null
xcrun simctl status_bar "$id" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null || true
t 240 xcrun simctl install "$id" "$APP"

# Per shape: the editor (Advanced's ground deck on the claw), then two layouts flown: Pro on the Show's ledge (RELEASE up)
# with the claw, and Advanced's valve deck in the Wall's air, left-handed (the stick's side swaps; the valves keep the car's
# left on the left) and minimal.
shape() { # <prefix> [shape args…]
  local pre=$1; shift
  shoot "$id" "$pre-editor" hud-editor -course show -tier pro -hudEdit pro -hudPreset claw "$@"
  shoot "$id" "$pre-claw-pro-ledge" frozen -course show -tier pro -play -autopilot -freeze 2250 -hudPreset claw "$@"
  shoot "$id" "$pre-lefty-pro-air" frozen -course show -tier pro -play -autopilot -freeze 2780 -hudPreset leftHanded "$@"
  shoot "$id" "$pre-minimal-adv-air" frozen -course wall -tier advanced -play -autopilot -freeze 3500 -hudPreset minimal "$@"
}
shape wide -orient landscape
shape tabletop -orient portrait -window 669x951 -pose tabletop
shape ipad -orient portrait -window 1032x1376
