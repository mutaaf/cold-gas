// src/sim/impacts.js: impact events in fixed typed arrays (Float32 where the JS has Float32Array).
public enum ImpactKind { public static let HIT: UInt8 = 0, SCRAPE: UInt8 = 1, WHEEL: UInt8 = 2, CRUSH: UInt8 = 3 }
public let IMPACT_CAP = 768, SCRAPE_EVERY = 8
public let HIT_MIN = 1.0, SCRAPE_MIN = 2.0, WHEEL_MIN = 3.0, CRUSH_STEP = 0.03
public enum PART { public static let floor: UInt8 = 0, nose: UInt8 = 1, tail: UInt8 = 2, side: UInt8 = 3, roof: UInt8 = 4, wheel: UInt8 = 5 }

public final class Impacts {
    public var count = 0
    public let cap: Int
    public var lastScrape: Double = -1e9
    public var tick: [Int32], kind: [UInt8], part: [UInt8], probe: [UInt8], body: [Int8]
    public var x: [Float], y: [Float], z: [Float], nx: [Float], ny: [Float], nz: [Float], speed: [Float], crush: [Float]
    public init(cap: Int = IMPACT_CAP) {
        self.cap = cap
        tick = .init(repeating: 0, count: cap); kind = .init(repeating: 0, count: cap); part = .init(repeating: 0, count: cap)
        probe = .init(repeating: 0, count: cap); body = .init(repeating: 0, count: cap)
        x = .init(repeating: 0, count: cap); y = x; z = x; nx = x; ny = x; nz = x; speed = x; crush = x
    }
    /// Record one event (dropped once the buffer is full: the first 768 are the crash).
    public func push(_ t: Double, _ k: UInt8, _ p: Double, _ pr: Double, _ b: Double, _ x: Double, _ y: Double, _ z: Double,
                     _ nx: Double, _ ny: Double, _ nz: Double, _ speed: Double, _ crush: Double) {
        if count >= cap { return }
        let i = count; count += 1
        tick[i] = jsInt32(t); kind[i] = k; part[i] = jsUint8(p); probe[i] = jsUint8(pr); body[i] = jsInt8(b)
        self.x[i] = f32(x); self.y[i] = f32(y); self.z[i] = f32(z); self.nx[i] = f32(nx); self.ny[i] = f32(ny); self.nz[i] = f32(nz)
        self.speed[i] = f32(speed); self.crush[i] = f32(crush)
    }
}
