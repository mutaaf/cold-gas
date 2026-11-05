#!/bin/sh
# The native app's rules that are easiest to enforce on the source (`make rules`; testflight.sh runs it first).
# After moon-club's scripts/check-rules.sh, with COLD GAS's invariants (docs/NATIVE.md §2, §7, §9):
#  1. No third-party SDKs or remote Swift packages: the only packages are our own, by path.
#  2. Own origin only: every web address in the app's Swift is mutaafaziz.com/coldgas.
#  3. No ads, analytics or attribution SDKs in the app (Marquee is a web loader; native has no ads).
#  4. Never force-unwrap state or content lookups in views: moon-club 0.8.0 crashed on TestFlight from exactly that
#     (a save or a server row naming something this build lacks). Use `if let` / `guard let` / a default.
#  5. Never branch on the device model; gate on capabilities (§2.8).
#  6. Every MARKETING_VERSION has release notes (release-notes/<version>.md): no emoji (TestFlight refuses them), ≤ 4000.
#  7. App Store readiness in Info.plist: no non-exempt encryption, arm64 + metal, a launch screen, a display name.
#  8. The privacy manifest declares each required-reason API the app calls, and once the app talks to the network
#     its collected data types are declared (store/app-privacy.md says which).
#  9. The store/ texts fit Apple's limits and carry no emoji.
# 10. A bundled font ships with its licence file.
set -e
cd "$(dirname "$0")/.."
fail=0
SRC="ColdGas Packages/ColdGasCore/Sources"

# 1
pk=$(grep -nE '^\s*[A-Za-z]+:\s*\{?\s*(url|github|from):' project.yml || true)
pk="$pk$(grep -nE '\.package\(\s*(name:[^,]*,\s*)?url:' Packages/*/Package.swift || true)"
[ -z "$pk" ] || { echo "✗ remote package dependencies are not allowed (own code only):"; echo "$pk"; fail=1; }
# 2
urls=$(grep -rnoE '"https?://[^"]*' $SRC --include='*.swift' | grep -vE '"https://mutaafaziz\.com/coldgas(/|")' || true)
[ -z "$urls" ] || { echo "✗ the app talks only to mutaafaziz.com/coldgas:"; echo "$urls"; fail=1; }
# 3
sdk=$(grep -rnE '^\s*import (Firebase|FirebaseAnalytics|Amplitude|Mixpanel|Segment|GoogleMobileAds|FBSDKCoreKit|FacebookCore|AppsFlyerLib|Adjust|Branch|Kochava|Singular|Sentry|Bugsnag|AppTrackingTransparency|AdSupport|AdServices)\b' $SRC --include='*.swift' || true)
[ -z "$sdk" ] || { echo "✗ no ads, analytics, tracking or attribution SDKs:"; echo "$sdk"; fail=1; }
# 4 (Debug/ is the -selftest harness, never a view)
fu=$(grep -rnE '(\[[^]]*\]!|state\.[A-Za-z]+!|\.last!|\.first!|\.randomElement\(\)!)' ColdGas --include='*.swift' | grep -v '^ColdGas/Debug/' || true)
[ -z "$fu" ] || { echo "✗ force-unwrapped state/content lookup (use if let / guard let / a default):"; echo "$fu"; fail=1; }
# 5
dm=$(grep -rnE 'UIDevice\.current\.(model|name)|utsname|"hw\.machine"|"iPhone[0-9]+,[0-9]+"' $SRC --include='*.swift' || true)
[ -z "$dm" ] || { echo "✗ branching on the device model (gate on capabilities: hasHinge, supportsHaptics, maximumFramesPerSecond):"; echo "$dm"; fail=1; }
# 6
v=$(sed -nE 's/.*MARKETING_VERSION: *"([^"]+)".*/\1/p' project.yml | head -1)
node scripts/asc.mjs notes "$v" >/dev/null || { echo "✗ release-notes/$v.md missing or invalid (see release-notes/README.md)"; fail=1; }
# 7
P=ColdGas/Info.plist
pl() { plutil -extract "$1" raw -o - "$P" 2>/dev/null || true; }
[ "$(pl ITSAppUsesNonExemptEncryption)" = false ] || { echo "✗ $P: ITSAppUsesNonExemptEncryption must be false"; fail=1; }
caps=$(plutil -extract UIRequiredDeviceCapabilities json -o - "$P" 2>/dev/null || true)
echo "$caps" | grep -q '"arm64"' && echo "$caps" | grep -q '"metal"' || { echo "✗ $P: UIRequiredDeviceCapabilities needs arm64 and metal"; fail=1; }
plutil -extract UILaunchScreen json -o - "$P" >/dev/null 2>&1 || { echo "✗ $P: no UILaunchScreen"; fail=1; }
[ -n "$(pl CFBundleDisplayName)" ] || { echo "✗ $P: no CFBundleDisplayName"; fail=1; }
# 8
M=ColdGas/Resources/PrivacyInfo.xcprivacy
need() { # need <grep pattern> <reason code> <what>
  if grep -rqE "$1" $SRC --include='*.swift' && ! grep -q "<string>$2</string>" "$M"; then echo "✗ $M: $3 is used, declare reason $2"; fail=1; fi
}
need 'UserDefaults' CA92.1 'UserDefaults'
need 'CACurrentMediaTime|systemUptime|mach_absolute_time' 35F9.1 'system boot time'
need 'creationDate|modificationDate|contentModificationDateKey|attributesOfItem' C617.1 'file timestamps'
need 'volumeAvailableCapacity|systemFreeSize' E174.1 'disk space'
grep -q '<key>NSPrivacyTracking</key><false/>' "$M" || { echo "✗ $M: NSPrivacyTracking must be false (no tracking)"; fail=1; }
if grep -rqE 'URLSession|URLRequest' $SRC --include='*.swift' && grep -qE '<key>NSPrivacyCollectedDataTypes</key><array/>' "$M"; then
  echo "✗ $M: the app now uses the network; declare the collected data types from store/app-privacy.md"; fail=1
fi
# 9
node scripts/asc.mjs store-lint >/dev/null || { node scripts/asc.mjs store-lint; fail=1; }
# 10. A bundled font ships with its licence (the review notes say Michroma and Geist are OFL; §7).
for f in $(find ColdGas -iname '*.ttf' -o -iname '*.otf' 2>/dev/null); do
  ls "$(dirname "$f")" | grep -qiE '^(OFL|LICENSE)' || { echo "✗ $f: bundle its licence (OFL.txt) beside it"; fail=1; }
done

[ $fail -eq 0 ] && echo "✓ native rules hold"
exit $fail
