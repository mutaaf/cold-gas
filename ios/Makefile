# The native app (docs/NATIVE.md §8). Targets after moon-club's.
#   make up       engine + project + tests + build + launch on the Duo and Pro Max simulators
#   make test     the core's tests (macOS): DMath, the 52 run vectors, the scorer, haptics, layout
#   make alloc    the tick's allocation check, optimised
#   make sim      build for the simulator and launch on the Duo
#   make shots    screenshots: the Duo (closed, book, tabletop via -window) and the Pro Max → build/shots
#   make bench    the 10 s turntable bench on the Pro Max simulator (prints BENCH …)
#   make device   build, install and run -selftest on the paired iPhone (prints SELFTEST …)
SHELL := /bin/bash
DUO ?= ColdGas Duo
PROMAX ?= ColdGas Pro Max
DD := build/dd
APP := $(DD)/Build/Products/Debug-iphonesimulator/ColdGas.app
BUNDLE := com.mutaafaziz.coldgas
id = $(shell xcrun simctl list devices available | grep -F "    $(1) (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')

.PHONY: up sims engine gen test alloc build sim shots bench device
up: sims engine gen test build sim
sims:
	# Our own simulators: another project on this Mac shares the stock "iPhone Duo" (it unfolds it, launches its app).
	@xcrun simctl list devices available | grep -q "    ColdGas Duo (" || xcrun simctl create "ColdGas Duo" com.apple.CoreSimulator.SimDeviceType.iPhone-Duo com.apple.CoreSimulator.SimRuntime.iOS-27-1
	@xcrun simctl list devices available | grep -q "    ColdGas Pro Max (" || xcrun simctl create "ColdGas Pro Max" com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max com.apple.CoreSimulator.SimRuntime.iOS-27-0
engine:
	@[ -d Packages/ColdGasCore/CRapier.xcframework ] || ./scripts/rapier.sh
gen:
	@command -v xcodegen >/dev/null || brew install xcodegen
	@xcodebuild -showComponent MetalToolchain >/dev/null 2>&1 || xcodebuild -downloadComponent MetalToolchain
	xcodegen generate --quiet
test: engine
	cd Packages/ColdGasCore && swift test --no-parallel   # the sim is single-threaded, as the JS module is
alloc: engine
	# The 240 Hz tick's allocations, optimised as the app is built (0152).
	cd Packages/ColdGasCore && swift test -c release -Xswiftc -enable-testing --no-parallel
build: engine gen
	# The first xcodebuild after xcodegen sometimes fails; rerun once (moon-club).
	xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath $(DD) -quiet build \
	  || xcodebuild -project ColdGas.xcodeproj -scheme ColdGas -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath $(DD) -quiet build
sim: build
	./scripts/sim.sh "$(DUO)" $(APP) $(BUNDLE)
shots: build
	./scripts/shots.sh build/shots
bench: build
	./scripts/sim.sh "$(PROMAX)" $(APP) $(BUNDLE) -bench
device: engine gen
	./scripts/device.sh
