// swift-tools-version: 6.0
// ColdGasCore: the sim, ported line for line from src/sim and held to the JS's bits by the vectors that
// `npm run vectors` writes (docs/NATIVE.md §3). Foundation only. ColdGasPhysics adds the engine (CRapier,
// built by ios/scripts/rapier.sh; Apple platforms). No remote dependencies, ever.
import PackageDescription

let apple: [Platform] = [.macOS, .iOS]
#if os(Linux)
// The cloud sandboxes (Linux, no Xcode) test the core alone; the engine is an Apple XCFramework.
let engine: [Target] = []
let physicsDeps: [Target.Dependency] = ["ColdGasCore"]
#else
let engine: [Target] = [.binaryTarget(name: "CRapier", path: "CRapier.xcframework")]
let physicsDeps: [Target.Dependency] = ["ColdGasCore", .target(name: "CRapier", condition: .when(platforms: apple))]
#endif

let package = Package(
    name: "ColdGasCore",
    platforms: [.macOS(.v14), .iOS(.v18)],
    products: [
        .library(name: "ColdGasCore", targets: ["ColdGasCore"]),
        .library(name: "ColdGasPhysics", targets: ["ColdGasPhysics"]),
    ],
    targets: [
        .target(name: "ColdGasCore", swiftSettings: [.swiftLanguageMode(.v5)]),
        .target(
            name: "ColdGasPhysics",
            dependencies: physicsDeps,
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "ColdGasCoreTests",
            dependencies: ["ColdGasCore"],
            path: "Tests",
            exclude: ["ColdGasPhysicsTests"],
            sources: ["ColdGasCoreTests"],
            resources: [.copy("Vectors")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "ColdGasPhysicsTests",
            dependencies: ["ColdGasPhysics", "ColdGasCore"],
            path: "Tests/ColdGasPhysicsTests",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ] + engine
)
