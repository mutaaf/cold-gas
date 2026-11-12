#!/usr/bin/env bash
# The flight deck on every shape (0210): a scripted run frozen at a moment (`-freeze <tick>`, DEBUG) with its controls up,
# shot on a phone upright and sideways, the Duo closed / book / tabletop (-window + -pose), and an iPad both ways.
#   scripts/deck-shots.sh [outdir]      (after `make build`; PHONE / DUO / IPAD name the simulators to use, empty skips one;
#                                       ONLY="pro-air adv-air" shoots just those moments)
# The simulators are the caller's own (another project on this Mac shares the stock ones).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-build/deck-shots}; mkdir -p "$OUT"
APP=build/dd/Build/Products/Debug-iphonesimulator/ColdGas.app BID=com.mutaafaziz.coldgas
PHONE=${PHONE-ColdGas Pro Max} DUO=${DUO-ColdGas Duo} IPAD=${IPAD-}
id_of() { xcrun simctl list devices available | grep -F "    $1 (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'; }
t() { local s=$1; shift; "$@" & local p=$!; ( sleep "$s"; kill $p 2>/dev/null ) 2>/dev/null & local w=$!; wait $p 2>/dev/null; kill $w 2>/dev/null; }
# The readiness file, found on disk: `simctl get_app_container` can hang for minutes on a loaded Mac.
readyfiles() { ls "$HOME/Library/Developer/CoreSimulator/Devices/$1/data/Containers/Data/Application/"*/Library/Caches/coldgas.ready 2>/dev/null; }
ready() { # <sim> <token>
  for _ in $(seq 1 ${READY_TRIES:-480}); do readyfiles "$1" | while read -r f; do grep -q "$2" "$f" && echo y; done | grep -q y && break; sleep 0.5; done
  sleep "${SETTLE:-1.5}"
}
shoot() { # <sim> <name> <course> <tier> <tick> [args…]
  local id=$1 name=$2 course=$3 tier=$4 tick=$5; shift 5
  t 20 xcrun simctl terminate "$id" $BID 2>/dev/null || true
  readyfiles "$id" | while read -r f; do rm -f "$f"; done
  t 30 xcrun simctl launch "$id" $BID -course "$course" -tier "$tier" -play -autopilot -freeze "$tick" "$@" >/dev/null
  ready "$id" frozen
  t 30 xcrun simctl io "$id" screenshot --display=primary "$OUT/$name.png" >/dev/null 2>&1 && echo "$OUT/$name.png"
}
up() { # <sim name> → id
  local id; id=$(id_of "$1"); [ -n "$id" ] || { echo "no simulator $1" >&2; return 1; }
  xcrun simctl boot "$id" 2>/dev/null || true
  t 240 xcrun simctl bootstatus "$id" -b >/dev/null
  xcrun simctl status_bar "$id" override --time 9:41 --batteryState charged --batteryLevel 100 2>/dev/null || true
  t 180 xcrun simctl install "$id" "$APP"
  echo "$id"
}
# The moments (sim ticks of the reference flights): the Show's run-up, its ledge, the air; the Wall's air for Advanced.
MOMENTS=("pro-ground show pro 400" "pro-ledge show pro 2250" "pro-air show pro 2780" "adv-air wall advanced 3500")
each() { # <sim id> <prefix> [args…]
  local id=$1 pre=$2; shift 2
  for m in "${MOMENTS[@]}"; do
    set -- $m "$@"; local n=$1 c=$2 tr=$3 tk=$4; shift 4
    [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $n "* ]] || continue
    shoot "$id" "$pre-$n" "$c" "$tr" "$tk" "$@"
  done
}
if [ -n "$PHONE" ] && P=$(up "$PHONE"); then
  each "$P" phone
  each "$P" phone-wide -orient landscape
fi
if [ -n "$DUO" ] && D=$(up "$DUO"); then
  each "$D" duo-closed
  each "$D" duo-book -window 951x669 -pose book
  each "$D" duo-tabletop -window 669x951 -pose tabletop
fi
if [ -n "$IPAD" ] && I=$(up "$IPAD"); then
  each "$I" ipad
  each "$I" ipad-wide -orient landscape
fi
