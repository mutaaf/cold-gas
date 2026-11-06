#!/bin/sh
# Archive COLD GAS (Release), export it with our own distribution signing and upload it to TestFlight.
# Copied from moon-club's scripts/testflight.sh; build numbers are UTC timestamps, as kin's (docs/NATIVE.md §8, §9).
# Then sets What to Test from release-notes/<version>.md and makes sure the internal group "Cold Gas Crew" has the team.
#
# Needs the owner's App Store Connect key config, never committed: ios/.env.testflight (gitignored; the same file
# moon-club keeps, so `cp ../moon-club/.env.testflight ios/.env.testflight`) or ASC_ENV=<path to one>.
#   EXPORT_ONLY=1  archive + export an .ipa to build/archive/out and stop: no upload (`make archive`)
#   VALIDATE=1     the same, then App Store validation (altool --validate-app), still without uploading
#   SKIP_TESTS=1   skip the rules and the core's tests (they run by default)
#   BETA_EXTERNAL=1  also hands the build to the external group and submits it for Beta App Review:
#                    only on a fresh yes from the owner in chat (§9)
set -e
cd "$(dirname "$0")/.."
ENVF=.env.testflight
[ -f "$ENVF" ] || ENVF="${ASC_ENV:-}"
[ -n "$ENVF" ] && [ -f "$ENVF" ] || { echo "testflight.sh: no App Store Connect key config. Copy moon-club's: cp ../../moon-club/.env.testflight .env.testflight (from ios/), or set ASC_ENV=<file>."; exit 1; }
. "$ENVF"
: "${TEAM_ID:?}" "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}" "${ASC_KEY_PATH:?}"
[ -f "$ASC_KEY_PATH" ] || { echo "testflight.sh: no API key at $ASC_KEY_PATH"; exit 1; }
export ASC_ENV="$(cd "$(dirname "$ENVF")" && pwd)/$(basename "$ENVF")"   # asc.mjs reads the same file

BUILD=$(date -u +%Y%m%d%H%M)   # unique and always increasing
VERSION=$(sed -nE 's/.*MARKETING_VERSION: *"([^"]+)".*/\1/p' project.yml | head -1)
node scripts/asc.mjs notes "$VERSION" >/dev/null   # no release notes, no build
node scripts/asc.mjs bundle
node scripts/asc.mjs signing   # the team's distribution cert + the "Cold Gas App Store" profile (no cloud signing)
[ "${SKIP_TESTS:-0}" = 1 ] || { make rules; make test; }
make engine gen >/dev/null

AUTH="-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY_PATH -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
ARCHIVE=build/archive/ColdGas.xcarchive
rm -rf build/archive
# The first xcodebuild after xcodegen sometimes fails; rerun once (moon-club).
archive() {
  xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration Release -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE" -derivedDataPath build/dd-release DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
    CURRENT_PROJECT_VERSION="$BUILD" $AUTH -quiet archive
}
archive || archive

DEST=upload
if [ "${EXPORT_ONLY:-0}" = 1 ] || [ "${VALIDATE:-0}" = 1 ]; then DEST=export; fi
cat > build/archive/export.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>$TEAM_ID</string>
<key>destination</key><string>$DEST</string><key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict><key>com.mutaafaziz.coldgas</key><string>Cold Gas App Store</string></dict>
<key>uploadSymbols</key><true/><key>manageAppVersionAndBuildNumber</key><false/></dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist build/archive/export.plist -exportPath build/archive/out $AUTH

if [ "$DEST" = export ]; then
  IPA=$(ls build/archive/out/*.ipa)
  echo "✓ $VERSION ($BUILD) archived and exported, signed for the App Store: ios/$IPA (not uploaded)"
  if [ "${VALIDATE:-0}" = 1 ]; then
    # altool finds the key as AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys.
    xcrun altool --validate-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
    echo "✓ $VERSION ($BUILD) passed App Store validation (not uploaded)."
  fi
  exit 0
fi
echo "✓ $VERSION ($BUILD) uploaded."
node scripts/asc.mjs ship "$BUILD"
