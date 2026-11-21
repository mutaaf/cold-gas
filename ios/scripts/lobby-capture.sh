#!/usr/bin/env bash
# Lobby's raw store frames (store/lobby/raw-1.2.0/<set>) from a Debug build: real gameplay frozen at a tick or waited for
# on a Ready token, -mute -uitest, status bar 9:41. One simulator at a time, made for the run and deleted after
# (the Mac is shared; ~/.claude/CLAUDE.md simulator hygiene).
#   cd ios && make build && scripts/lobby-capture.sh iphone|ipad|duo [frame…]
# Frames: flight wreck judges firstjump drive challenge touchdown valves editor water tabletop
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
SET=$1; shift
APP=${LOBBY_APP:-build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app} BID=com.mutaafaziz.coldgas
OUT=../store/lobby/raw-1.2.0/$SET TMP=$(mktemp -d)
mkdir -p "$OUT"
case $SET in
  iphone) TYPE=iPhone-18-Pro-Max RT=iOS-27-0 FRAMES=${*:-flight wreck judges firstjump drive challenge touchdown valves editor water} ;;
  ipad)   TYPE=iPad-Pro-13-inch-M5-12GB RT=iOS-27-0 FRAMES=${*:-flight wreck judges firstjump drive challenge touchdown valves editor water} ;;
  duo)    TYPE=iPhone-Duo RT=iOS-27-1 FRAMES=${*:-flight wreck judges firstjump drive tabletop} ;;
  *) echo "set: iphone|ipad|duo"; exit 2 ;;
esac
VS='https://mutaafaziz.com/coldgas/?play=jump&course=show#vs=rASAAoAEBTUFaBgAAxgGKyAHUAoDFAY4BhsgBPAO2AQRnhYYBc4bHAcoGA7UBBGiFhQE'
spec() { # <frame> → file token settle args…
  case $1 in
    flight)    echo "01-flight frozen 1.5 -play -autopilot -course show -freeze 2700" ;;
    wreck)     echo "02-wreck frozen 1.5 -play -script crash-show-carry5 -freeze 3480" ;;
    judges)    echo "03-judges results 8 -play -autopilot" ;;
    firstjump) echo "04-firstjump frozen 1.5 -firstrun -play -freeze 1300" ;;
    drive)     echo "05-drive drive 5 -freedrive -fd-km 3 -fd-cruise 25" ;;
    challenge) echo "06-challenge challenge 2 -open $VS" ;;
    touchdown) echo "07-touchdown frozen 1.5 -play -autopilot -course show -freeze 3400" ;;
    valves)    echo "08-valves frozen 1.5 -play -autopilot -course show -tier advanced -freeze 2700" ;;
    editor)    echo "09-editor hud-editor 2 -hudEdit assist" ;;
    water)     echo "11-water drive 4 -freedrive -fd-tod golden -fd-at 3397,-1165,-135" ;;
    tabletop)  echo "10-tabletop frozen 1.5 -window 669x951 -pose tabletop -play -autopilot -course show -freeze 2700" ;;
  esac
}
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
id=$(xcrun simctl create "ColdGas Lobby $SET" "com.apple.CoreSimulator.SimDeviceType.$TYPE" "com.apple.CoreSimulator.SimRuntime.$RT") || exit 1
trap 'xcrun simctl shutdown "$id" 2>/dev/null; xcrun simctl delete "$id" 2>/dev/null; rm -rf "$TMP"' EXIT
xcrun simctl boot "$id"; t 300 xcrun simctl bootstatus "$id" -b >/dev/null
xcrun simctl status_bar "$id" override --time 9:41 --batteryState charged --batteryLevel 100
t 240 xcrun simctl install "$id" "$APP"
for f in $FRAMES; do
  read -r file token settle rest <<<"$(spec "$f")"
  xcrun simctl terminate "$id" $BID 2>/dev/null || true
  d=$(xcrun simctl get_app_container "$id" $BID data); rm -f "$d/Library/Caches/coldgas.ready"
  # shellcheck disable=SC2086
  t 30 xcrun simctl launch "$id" $BID -mute -uitest $rest >/dev/null
  ok=; for _ in $(seq 1 360); do grep -q "^$token" "$d/Library/Caches/coldgas.ready" 2>/dev/null && ok=1 && break; sleep 0.5; done
  sleep "$settle"
  t 30 xcrun simctl io "$id" screenshot --display=primary "$TMP/$file.png" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 92 "$TMP/$file.png" --out "$OUT/$file.jpg" >/dev/null && echo "$SET/$file $([ -n "$ok" ] && echo ok || echo "NO TOKEN $token")"
done
