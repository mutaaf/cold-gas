#!/bin/sh
# Let Xcode register COLD GAS's App ID on the developer portal with the App Store Connect API key, the way
# moon-club's scripts/provision.sh does: a Debug build for a generic device with -allowProvisioningUpdates.
# Idempotent. (asc.mjs bundle registers the id through the API too; this also makes the development profile.)
set -e
cd "$(dirname "$0")/.."
ENVF=.env.testflight
[ -f "$ENVF" ] || ENVF="${ASC_ENV:-}"
[ -n "$ENVF" ] && [ -f "$ENVF" ] || { echo "provision.sh: no App Store Connect key config (ios/.env.testflight or ASC_ENV; copy moon-club's)."; exit 1; }
. "$ENVF"
make engine gen >/dev/null
xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration Debug -destination generic/platform=iOS \
  -derivedDataPath build/provision DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" -quiet build
echo "✓ App ID com.mutaafaziz.coldgas and its development profile are registered"
