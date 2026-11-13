// The sound's synthesis (0240) rendered by hand on the Mac: it stays finite and inside full scale whatever it's asked,
// every layer and one-shot actually makes sound, the side-chain key ducks the bed, and the callbacks stay cheap.
import XCTest
import Darwin
@testable import ColdGasAudio

final class AudioTests: XCTestCase {
    let sr = 48000.0

    struct Rig {
        let bedP = ParamBlock(count: BP.allCases.count), bedR = EventRing(), keys = ParamBlock(count: 2), meter = RenderMeter()
        let emP = ParamBlock(count: EP.allCases.count), emR = EventRing()
        var bed: BedCore, em: EmitterCore
        init(sr: Double) {
            bed = BedCore(sr: sr, params: bedP, ring: bedR, keys: keys, meter: meter)
            em = EmitterCore(sr: sr, params: emP, ring: emR, keys: keys, keySlot: 0, meter: meter)
            bedP.set(BP.master.rawValue, 0.8); bedP.set(BP.fx.rawValue, 1); bedP.set(BP.music.rawValue, 1)
            bedP.set(BP.split.rawValue, 1); bedP.set(BP.paved.rawValue, 1); bedP.set(BP.grounded.rawValue, 1)
            emP.set(EP.fx.rawValue, 0.8); emP.set(EP.doppler.rawValue, 1)
        }
        mutating func render(seconds: Double, _ sr: Double) -> (l: [Float], e: [Float]) {
            let n = Int(seconds * sr), block = 480
            var l = [Float](repeating: 0, count: n), r = [Float](repeating: 0, count: n), e = [Float](repeating: 0, count: n)
            var i = 0
            while i < n {
                let k = min(block, n - i)
                l.withUnsafeMutableBufferPointer { lp in r.withUnsafeMutableBufferPointer { rp in bed.render(lp.baseAddress! + i, rp.baseAddress! + i, k) } }
                e.withUnsafeMutableBufferPointer { ep in em.render(ep.baseAddress! + i, k) }
                i += k
            }
            return (l, e)
        }
        func free() { bed.free(); em.free(); bedP.free(); bedR.free(); keys.free(); meter.free(); emP.free(); emR.free() }
    }

    func rms(_ x: ArraySlice<Float>) -> Double { sqrt(x.reduce(0.0) { $0 + Double($1 * $1) } / Double(max(1, x.count))) }

    func driving(_ rig: inout Rig, speed: Double, load: Double) {
        let p = rig.bedP
        p.set(BP.speed.rawValue, speed); p.set(BP.spinHz.rawValue, speed / (2 * .pi * 0.367))
        p.set(BP.motorHz.rawValue, speed / (2 * .pi * 0.367) * 9); p.set(BP.load.rawValue, load)
    }

    func testDrivetrainSingsAndStaysInsideFullScale() {
        var rig = Rig(sr: sr); defer { rig.free() }
        let idle = rig.render(seconds: 0.5, sr).l
        driving(&rig, speed: 30, load: 1)
        let fast = rig.render(seconds: 1, sr).l
        XCTAssertLessThan(rms(idle[...]), 1e-3, "a car at rest on the title makes no drivetrain sound")
        XCTAssertGreaterThan(rms(fast[24000...]), 0.01, "at 30 m/s under load the drivetrain is heard")
        XCTAssertTrue(fast.allSatisfy { $0.isFinite && abs($0) <= 1 })
    }

    func testLoadChangesTheVoice() {
        var on = Rig(sr: sr), off = Rig(sr: sr); defer { on.free(); off.free() }
        driving(&on, speed: 20, load: 1); driving(&off, speed: 20, load: 0)
        on.bedP.set(BP.paved.rawValue, 0); off.bedP.set(BP.paved.rawValue, 0)   // the drivetrain alone
        let a = on.render(seconds: 1, sr).l, b = off.render(seconds: 1, sr).l
        XCTAssertGreaterThan(rms(a[24000...]), rms(b[24000...]) * 1.5, "on throttle the whine is louder than coasting")
    }

    func testEverySurfaceIsHeard() {
        for (name, slot) in [("gravel", BP.gravel), ("grass", BP.grass), ("wet", BP.wet)] {
            var rig = Rig(sr: sr); defer { rig.free() }
            rig.bedP.set(BP.paved.rawValue, 0); rig.bedP.set(slot.rawValue, 1)
            rig.bedP.set(BP.speed.rawValue, 20)
            let x = rig.render(seconds: 1, sr).l
            XCTAssertGreaterThan(rms(x[24000...]), 0.003, "\(name) under the tyres makes sound")
        }
    }

    func testEveryOneShotSoundsAndEnds() {
        for k in 0...11 {
            var rig = Rig(sr: sr); defer { rig.free() }
            rig.bedR.push(SoundEvent(kind: UInt8(k), a: k == BedEvent.land.rawValue.int ? 3 : 0.8, b: 1, c: 0.4, d: 0.5, seed: 7))
            let x = rig.render(seconds: 3, sr).l
            XCTAssertGreaterThan(x[0..<48000].map { abs($0) }.max() ?? 0, 0.002, "bed event \(k) makes a sound")
            XCTAssertLessThan(rms(x[120000...]), 1e-3, "bed event \(k) dies away")
            XCTAssertTrue(x.allSatisfy { $0.isFinite && abs($0) <= 1 })
        }
        for m in 0...6 {
            var rig = Rig(sr: sr); defer { rig.free() }
            rig.emR.push(SoundEvent(kind: EmitterEvent.impact.rawValue, a: Double(m), b: 1, c: 1, seed: 3))
            let e = rig.render(seconds: 3, sr).e
            XCTAssertGreaterThan(e.map { abs($0) }.max() ?? 0, 0.05, "material \(m) rings")
            XCTAssertTrue(e.allSatisfy { $0.isFinite && abs($0) <= 1 })
        }
    }

    func testAnImpactDucksTheBed() {
        var a = Rig(sr: sr), b = Rig(sr: sr); defer { a.free(); b.free() }
        for r in [a, b] { r.bedP.set(BP.speed.rawValue, 30); r.bedP.set(BP.paved.rawValue, 1) }
        b.keys.set(0, 1)   // an emitter's key at full
        b.keys.set(1, 1)
        let x = a.render(seconds: 1, sr).l, y = b.render(seconds: 1, sr).l
        XCTAssertLessThan(rms(y[24000...]), rms(x[24000...]) * 0.7)
    }

    /// The cost of the render callbacks with everything on: the drivetrain, gravel, a squeal, ABS, jets, grinding, the
    /// ambience, the crowd and a storm of one-shots. Printed for the record; the bound is generous for a loaded CI Mac.
    func testRenderCost() {
        var rig = Rig(sr: sr); defer { rig.free() }
        driving(&rig, speed: 35, load: -0.6)
        for (s, v) in [(BP.gravel, 0.6), (.slip, 0.8), (.abs, 1), (.lift, 3.0), (.side, 2.0), (.grind, 0.6), (.trees, 1), (.crickets, 1), (.breeze, 1), (.rough, 0.5)] { rig.bedP.set(s.rawValue, v) }
        rig.emP.set(EP.crowd.rawValue, 1)
        for i in 0..<20 { rig.bedR.push(SoundEvent(kind: BedEvent.crunch.rawValue, a: 1, b: 1, seed: Int64(i + 1))) }
        for i in 0..<20 { rig.emR.push(SoundEvent(kind: EmitterEvent.impact.rawValue, a: Double(i % 7), b: 1, c: 1, seed: Int64(i + 1))) }
        let t0 = Date()
        _ = rig.render(seconds: 10, sr)
        let share = Date().timeIntervalSince(t0) / 10
        print(String(format: "AUDIO render cost: %.2f%% of one core (bed + one emitter, everything on, 64 one-shots)", share * 100))
        XCTAssertLessThan(share, 0.25)
    }
}

private extension UInt8 { var int: Int { Int(self) } }
