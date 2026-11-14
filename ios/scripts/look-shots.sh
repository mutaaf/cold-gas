#!/usr/bin/env bash
# Every screen of the app at every pose, for a look pass (0230): an iPhone upright and sideways, the iPhone Duo open
# (edge to edge) and in tabletop (scene on top, controller below), laid out with -window as scripts/shots.sh does.
# One simulator at a time, shut down after its shots (the Mac is shared).
#   scripts/look-shots.sh <outdir> <prefix> [phone|duo|all] [screen…]
# Screens: title run pause results whatsnew board settings howto practice editor drive roam
#   and the first run (0249): firstrun guide firstlanding firstwreck; a wreck's results (0258): wreck; a challenge link (0253): challenge
# Simulators: $LOOK_PHONE (default "ColdGas Look", an iPhone 18 Pro) and $LOOK_DUO (default "ColdGas Look Duo").
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=$1 PRE=$2 WHICH=${3:-all}; shift 3 2>/dev/null || shift $#
SCREENS=${*:-title run pause results whatsnew board settings howto practice editor drive roam}
mkdir -p "$OUT"
APP=${LOOK_APP:-build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app} BID=com.mutaafaziz.coldgas
id_of() { xcrun simctl list devices available | grep -F "    $1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
shoot() { # <sim> <name> <token> <settle> [args…]
  local id=$1 name=$2 token=$3 settle=$4; shift 4
  xcrun simctl terminate "$id" $BID 2>/dev/null || true
  local d; d=$(xcrun simctl get_app_container "$id" $BID data 2>/dev/null) && rm -f "$d/Library/Caches/coldgas.ready"
  t 30 xcrun simctl launch "$id" $BID -uitest "$@" >/dev/null
  for _ in $(seq 1 240); do grep -q "$token" "$d/Library/Caches/coldgas.ready" 2>/dev/null && break; sleep 0.5; done
  sleep "$settle"
  t 30 xcrun simctl io "$id" screenshot --display=primary "$OUT/$PRE-$name.png" >/dev/null 2>&1 && echo "$PRE-$name"
}
args_for() { # <screen> → token settle args…
  case $1 in
    title) echo "frame 3" ;;
    run) echo "frozen 1 -play -autopilot -freeze 1900" ;;
    pause) echo "paused 1.5 -play -paused" ;;
    results) echo "results 6 -play -autopilot" ;;
    whatsnew) echo "frame 3 -whatsNew" ;;
    board) echo "frame 5 -sheet board" ;;
    settings) echo "frame 3 -sheet settings" ;;
    howto) echo "frame 3 -sheet howTo" ;;
    practice) echo "frame 3 -sheet practice" ;;
    editor) echo "hud-editor 2 -hudEdit assist" ;;
    drive) echo "drive 4 -freedrive" ;;
    roam) echo "drive 4 -roam show" ;;
    firstrun) echo "frame 3 -firstrun" ;;
    guide) echo "frozen 1 -firstrun -play -freeze 400" ;;
    firstlanding) echo "first-landing 3 -firstrun -play -autopilot" ;;
    firstwreck) echo "results 4 -firstrun -play -script crash-show-carry5" ;;
    wreck) echo "results 6 -play -script crash-show-carry5" ;;
    challenge) echo "challenge 2 -open https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=rASAAoAEBTUFaBgAAxgGKyAHUAoDFAY4BhsgBPAO2AQRnhYYBc4bHAcoGA7UBBGiFhQE" ;;
  esac
}
run_on() { # <sim name> <pose…>
  local dev=$1; shift
  local id; id=$(id_of "$dev"); [ -n "$id" ] || { echo "no simulator $dev"; return; }
  xcrun simctl boot "$id" 2>/dev/null || true
  t 300 xcrun simctl bootstatus "$id" -b >/dev/null
  xcrun simctl status_bar "$id" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null || true
  t 240 xcrun simctl install "$id" "$APP"
  for pose in "$@"; do
    local extra=()
    case $pose in
      portrait) extra=(-orient portrait) ;;
      landscape) extra=(-orient landscape) ;;
      duo-open) extra=(-window 951x669 -pose flat) ;;
      duo-tabletop) extra=(-window 669x951 -pose tabletop) ;;
    esac
    for s in $SCREENS; do
      read -r token settle rest <<<"$(args_for "$s")"
      # shellcheck disable=SC2086
      shoot "$id" "$s-$pose" "$token" "$settle" "${extra[@]}" $rest
    done
  done
  xcrun simctl terminate "$id" $BID 2>/dev/null || true
  xcrun simctl shutdown "$id" 2>/dev/null || true
}
[ "$WHICH" = duo ] || run_on "${LOOK_PHONE:-ColdGas Look}" portrait landscape
[ "$WHICH" = phone ] || run_on "${LOOK_DUO:-ColdGas Look Duo}" duo-open duo-tabletop
