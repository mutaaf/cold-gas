# The native app (docs/NATIVE.md §8). Targets after moon-club's.
#   make up       engine + project + tests + build + launch on the Duo and Pro Max simulators
#   make test     the core's tests (macOS): DMath, the 52 run vectors, the scorer, haptics, layout
#   make alloc    the tick's allocation check, optimised
#   make sim      build for the simulator and launch on the Duo
#   make shots    screenshots: the Duo (closed, book, tabletop via -window) and the Pro Max → build/shots
#   make bench    the 10 s turntable bench on the Pro Max simulator (prints BENCH …)
#   make device   build, install and run -selftest on the paired iPhone (prints SELFTEST …)
SHELL := /bin/bash
DUO ?= iPhone Duo
PROMAX ?= iPhone 18 Pro Max
DD := build/dd
APP := $(DD)/Build/Products/Debug-iphonesimulator/ColdGas.app
BUNDLE := com.mutaafaziz.coldgas
id = $(shell xcrun simctl list devices available | grep -F "    $(1) (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')

.PHONY: up engine gen test alloc build sim shots bench device
up: engine gen test build sim
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
