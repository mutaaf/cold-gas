// src/sim/spec.js: THE CAR. The numbers and their sources live in the JS file (one source); this is the same
// arithmetic, in the same order, so every derived value has the same bits.
public enum SPEC {
    public static let length = 4.33, width = 2.0, height = 1.15, wheelbase = 2.825
    public static let trackFront = 1.70, trackRear = 1.74, overhangFront = 0.85
    public static let wheelRadiusFront = 0.343, wheelRadiusRear = 0.367, wheelRadius = 0.355
    public static let tyreWidthFront = 0.295, tyreWidthRear = 0.335
    public static let tyreMu = 1.25
    public static let tyreLoadSens = -0.128085 / 0.932775
    public static let tyreKyLoad = 2.293896
    public static let tyreMu0 = 1.40
    public static let tyreRelaxFront = 0.35, tyreRelaxRear = 0.40
    public static let rideHeight = 0.10, comHeight = 0.40, comFromFront = 1.62
    public static let dryMass = 2150.0, gasVolumeL = 600.0, gasPressureBar = 690.0, gasMass = 297.0
    public static let inertiaRoll = 615.0, inertiaPitch = 2680.0, inertiaYaw = 3080.0
    public static let power = 1_000_000.0, maxWheelTorque = 11760.0, brakeTorque = 5200.0
    public static let steerLock = 0.5, steerRate = 2.2, escSlip = 0.07, escYaw = 1.04
    public static let fanMaxForce = 46000.0, fanSkirtReach = 0.22, fanGapScale = 0.008, fanGrip = 0.6, fanContact = 0.7
    public static let fanHang = 1.0, fanGripTime = 0.25, fanVoidSpeed = 22.0, fanIdleForce = 1300.0
    public static let fanSpool = 1.5, fanHold = 4.0, fanDump = 0.4
    public static let cdA = 0.55, ispFull = 72.0, regulatedFraction = 0.55
}
public let AXLE_F = SPEC.comFromFront, AXLE_R = SPEC.comFromFront - SPEC.wheelbase
@inline(__always) func yUp(_ h: Double) -> Double { h - SPEC.comHeight }

public struct Nozzle: Sendable {
    public let id: String, group: String
    public let pos: (Double, Double, Double), dir: (Double, Double, Double)
    public let max: Double
}
public let NOZZLE_SPEC: [Nozzle] = [
    Nozzle(id: "down-fr", group: "lift", pos: (-0.75, yUp(0.18), AXLE_F - 0.47), dir: (0, 1, 0), max: 23000),
    Nozzle(id: "down-fl", group: "lift", pos: (0.75, yUp(0.18), AXLE_F - 0.47), dir: (0, 1, 0), max: 23000),
    Nozzle(id: "down-rr", group: "lift", pos: (-0.75, yUp(0.18), AXLE_R - 0.53), dir: (0, 1, 0), max: 16000),
    Nozzle(id: "down-rl", group: "lift", pos: (0.75, yUp(0.18), AXLE_R - 0.53), dir: (0, 1, 0), max: 16000),
    Nozzle(id: "rear-1", group: "rear", pos: (-0.39, yUp(0.42), AXLE_R - 0.63), dir: (0, 0, 1), max: 20000),
    Nozzle(id: "rear-2", group: "rear", pos: (-0.13, yUp(0.42), AXLE_R - 0.64), dir: (0, 0, 1), max: 20000),
    Nozzle(id: "rear-3", group: "rear", pos: (0.13, yUp(0.42), AXLE_R - 0.64), dir: (0, 0, 1), max: 20000),
    Nozzle(id: "rear-4", group: "rear", pos: (0.39, yUp(0.42), AXLE_R - 0.63), dir: (0, 0, 1), max: 20000),
    Nozzle(id: "yaw-r", group: "yaw", pos: (-0.86, yUp(0.37), AXLE_F + 0.6), dir: (1, 0, 0), max: 4000),
    Nozzle(id: "yaw-l", group: "yaw", pos: (0.86, yUp(0.37), AXLE_F + 0.6), dir: (-1, 0, 0), max: 4000),
]
@inline(__always) public func wheelRadiusOf(_ i: Int) -> Double { i < 2 ? SPEC.wheelRadiusFront : SPEC.wheelRadiusRear }
public func wheelAnchors() -> [(Double, Double, Double)] {
    let zf = AXLE_F, zr = AXLE_R
    let yf = SPEC.wheelRadiusFront - SPEC.comHeight + 0.24, yr = SPEC.wheelRadiusRear - SPEC.comHeight + 0.24
    return [(-SPEC.trackFront / 2, yf, zf), (SPEC.trackFront / 2, yf, zf), (-SPEC.trackRear / 2, yr, zr), (SPEC.trackRear / 2, yr, zr)]
}
