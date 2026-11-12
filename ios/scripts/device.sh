#!/usr/bin/env bash
# Build, install and run -selftest on the paired iPhone (the physical leg of 0147: the vectors on the phone).
# CONFIG=Release and LAUNCH="<args>" run something else (Free Drive's bench: make device-bench-freedrive, 0216).
# The common failures in plain words (fantasy-edge's device.sh): nothing paired, nothing signed, developer not trusted.
set -uo pipefail
cd "$(dirname "$0")/.."
UDID=${DEVICE_ID:-$(xcrun xctrace list devices 2>/dev/null | sed -n '/== Devices ==/,/== Devices Offline ==/p' | grep -E "iPhone|iPad" | grep -oE '\(([0-9A-Fa-f-]{25,})\)$' | tr -d '()' | head -1)}
[ -n "$UDID" ] || { echo "device.sh: no iPhone connected and unlocked. Plug it in (or pair it over Wi-Fi in Xcode once)."; exit 1; }
DD=build/dd-device
# Xcode only registers a device it is building FOR (fantasy-edge): build at the device id, both flags.
CONFIG=${CONFIG:-Debug}
xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration "$CONFIG" -destination "id=$UDID" -derivedDataPath $DD \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build || { echo "device.sh: build/signing failed (team Z73865R687, Automatic)."; exit 1; }
APP=$DD/Build/Products/$CONFIG-iphoneos/ColdGas.app
xcrun devicectl device install app --device "$UDID" "$APP" >/dev/null || { echo "device.sh: install failed. On the phone: Settings → General → VPN & Device Management → trust the developer."; exit 1; }
xcrun devicectl device process launch --console --terminate-existing --device "$UDID" com.mutaafaziz.coldgas ${LAUNCH:--selftest} "$@" 2>&1 | grep -m ${LINES_MAX:-3} -E "^(SELFTEST|BENCH|PIPELINES|DRIVE)" 
