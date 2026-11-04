#!/usr/bin/env bash
# Builds ios/Vendor/Rapier (Rapier 0.36.0 behind a C API, docs/NATIVE.md §3) for macOS, iPhone and the
# iPhone simulator, and wraps it as Vendor/CRapier.xcframework (gitignored: built, never committed).
# Needs rustup (brew install rustup; rustup target add aarch64-apple-ios aarch64-apple-ios-sim).
# Cargo.lock pins glam 0.33.10 and smallvec 1.16.2: the versions inside the web's WASM build.
set -euo pipefail
cd "$(dirname "$0")/../Vendor/Rapier"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
export IPHONEOS_DEPLOYMENT_TARGET=18.0 MACOSX_DEPLOYMENT_TARGET=14.0
for t in aarch64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim; do
  cargo build --locked --release --target "$t" --lib
done
out=../../Packages/ColdGasCore/CRapier.xcframework
rm -rf "$out"
xcodebuild -create-xcframework \
  -library target/aarch64-apple-darwin/release/libcoldgas_rapier.a -headers include \
  -library target/aarch64-apple-ios/release/libcoldgas_rapier.a -headers include \
  -library target/aarch64-apple-ios-sim/release/libcoldgas_rapier.a -headers include \
  -output "$out" >/dev/null
echo "rapier.sh: built ios/Packages/ColdGasCore/CRapier.xcframework"
