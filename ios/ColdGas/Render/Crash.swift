// src/render/crash.js, ported (0153): everything a crash shows, keyed to the sim's impact events, seeded from each event
// (tick, probe) exactly as the web seeds it, so a crash throws the same sparks on the phone as in the browser:
//   HIT     sparks off the contact, a white flash, glass / carbon / paint chips, a dust ring on concrete, a vented
//           nitrogen line on a big hit, the camera's shake and a slow-motion beat
//   SCRAPE  a stream of sparks, dust off a scraping body
//   WHEEL   dust from a slammed tyre, a shake
//   and on a HIT: parts torn off (Debris.swift), the canopy crazing, lamps flickering out, hazards (CarState draws them)
// (A struck parked car's rock on its springs is the sim's, as on the web: Replay.body poses it. The crash cut is Director's.)
// Pools are fixed (the web's high tier: 520 sparks, 220 chips, 320 puffs); nothing is allocated per frame.
import Foundation
import simd
import UIKit
import ColdGasCore

struct SparkGPU { var pos: SIMD4<Float>; var vel: SIMD4<Float> }          // pos.w life (1 → 0), vel.w heat
struct PuffGPU { var pos: SIMD4<Float>; var color: SIMD4<Float> }         // pos.w size; colour.a alpha
struct ChipGPU { var pos: SIMD4<Float>; var rot: SIMD4<Float>; var scale: SIMD4<Float>; var color: SIMD4<Float> }

final class Crash {
    static let NS = 520, NC = 220, NM = 320
    private let G: Float = 9.81
    let reduced = UIAccessibility.isReduceMotionEnabled
    // Seeded randomness, as the web's (Park–Miller), reseeded per event.
    private var seed: Double = 1
    private func rnd() -> Float { seed = (seed * 16807).truncatingRemainder(dividingBy: 2147483647); return Float(seed / 2147483647) }
    private func sgn() -> Float { rnd() * 2 - 1 }
    private func reseed(_ a: Int, _ b: Int) { seed = Double(((a * 7919 + b * 104729 + 12345) % 2147483646) + 1); for _ in 0..<3 { _ = rnd() } }

    // Sparks
    private var sPos = [SIMD3<Float>](repeating: .zero, count: NS), sVel = [SIMD3<Float>](repeating: .zero, count: NS)
    private var sLife = [Float](repeating: 0, count: NS), sHeat = [Float](repeating: 0, count: NS), sDecay = [Float](repeating: 1, count: NS)
    private var sHead = 0
    // Chips
    private var cPos = [SIMD3<Float>](repeating: .zero, count: NC), cVel = [SIMD3<Float>](repeating: .zero, count: NC)
    private var cRot = [simd_quatf](repeating: simd_quatf(angle: 0, axis: [0, 1, 0]), count: NC), cSpin = [SIMD3<Float>](repeating: .zero, count: NC)
    private var cScale = [SIMD3<Float>](repeating: .zero, count: NC), cLife = [Float](repeating: 0, count: NC), cColor = [SIMD3<Float>](repeating: .one, count: NC)
    private var cHead = 0
    // Puffs
    private var mPos = [SIMD3<Float>](repeating: .zero, count: NM), mVel = [SIMD3<Float>](repeating: .zero, count: NM)
    private var mLife = [Float](repeating: 0, count: NM), mDecay = [Float](repeating: 1, count: NM), mSize0 = [Float](repeating: 0, count: NM)
    private var mGrow = [Float](repeating: 0, count: NM), mAlpha0 = [Float](repeating: 0, count: NM), mCol = [SIMD3<Float>](repeating: .one, count: NM)
    private var mSize = [Float](repeating: 0, count: NM), mAlpha = [Float](repeating: 0, count: NM)
    private var mHead = 0
    // Flash
    private(set) var flashPos = SIMD3<Float>(), flashS: Float = 0, flashT: Float = 0
    // State
    private var cursor = 0, lastTick = -1
    private(set) var slowK: Float = 1
    private var slowT: Float = 0, clock: Float = 0, bigT: Float = -10, ventT: Float = 0
    private(set) var grind: Float = 0
    /// A live run is heard (crash.js's crunch / thud / setGrind); the title's looping reference run is not.
    var audible = false
    /// Dent hooks (the renderer owns the meshes): hero(probe, crush, normal, salt), parked(body, point, normal, depth, salt).
    var dentHero: ((Int, Float, SIMD3<Float>, Float) -> Void)?
    var dentParked: ((Int, SIMD3<Float>, SIMD3<Float>, Float, Float) -> Void)?
    private var carVel = SIMD3<Float>(), carPos = SIMD3<Float>(), carQuat = simd_quatf(angle: 0, axis: [0, 1, 0])
    var shake: ((Float) -> Void)?
    /// The car's own states and damage (roadster.js): lamps, parts, the canopy. Crash sets the damage, the renderer draws it.
    let car = CarState()
    /// The torn-off parts: free rigid boxes on the concrete.
    let pieces = Debris()
    /// crash.js parkedFor's paint per body (from the stage), as sRGB hex.
    var paints: [UInt32] = []
    private var layout = CarLayout()
    // The breakables, as crash.js lists them (the order matters: each draws from the event's seeded rnd in turn).
    struct Breakable { let group: CarState.Group; let source: CarState.Source; let center: SIMD3<Float>; let piece: Int; let hits: [UInt8]; let min: Float }
    private(set) var breakable: [Breakable] = []
    /// The stage's car: crash.js's `piece` calls.
    func configure(layout l: CarLayout, paints p: [UInt32]) {
        layout = l; paints = p
        pieces.removeAll(); breakable.removeAll()
        func add(_ g: CarState.Group, _ s: CarState.Source, _ c: SIMD3<Float>, _ half: SIMD3<Float>, _ hits: [UInt8], _ min: Float) {
            breakable.append(Breakable(group: g, source: s, center: c, piece: pieces.add(half: half), hits: hits, min: min))
        }
        add(.wing, .wing, l.wingCenter, l.wingHalf, [PART.tail], 5.5)
        add(.vanes, .vanes, l.vanesCenter, l.vanesHalf, [PART.nose], 5)
        let skirtHits = [PART.floor, PART.side, PART.nose, PART.tail], skirtY = Float(SPEC.rideHeight) + 0.012 + 0.06, zF = Float(SPEC.wheelbase - SPEC.comFromFront)
        for s: Float in [-1, 1] {
            add(.skirts, .sideSkirts, SIMD3(s * 0.8, skirtY, 0), SIMD3(0.007, 0.06, 0.95), skirtHits, 6)
            add(.skirts, .endSkirts, SIMD3(0, skirtY, s * 0.95), SIMD3(0.8, 0.06, 0.007), skirtHits, 6)
            add(.barge, .barge, SIMD3(s * 0.93, 0.25, zF - 0.5), SIMD3(0.006, 0.08, 0.13), [PART.nose, PART.side], 7)
        }
    }
    private var brokenNow = [Bool](repeating: false, count: CarState.Group.allCases.count)
    private func tearOff(_ part: UInt8, _ v: Float, _ sev: Float, _ n: SIMD3<Float>) {
        for i in brokenNow.indices { brokenNow[i] = false }
        for b in breakable {
            if pieces.isOn(b.piece) || v < b.min || !car.visible(b.source) { continue }
            if !b.hits.contains(part) && !(v > 11 && rnd() < 0.5) { continue }
            let (m, q) = car.world(b.source, layout: layout, carPos: carPos, carQuat: carQuat)
            let c4 = m * SIMD4(b.center, 1)
            let kick = 1.5 + 4 * sev
            let bv = SIMD3(carVel.x * 0.85 + n.x * kick + sgn() * 1.2, carVel.y * 0.4 + abs(n.y) * kick * 0.6 + 1 + rnd() * 2, carVel.z * 0.85 + n.z * kick + sgn() * 1.2)
            let bw = SIMD3(sgn() * 8, sgn() * 6, sgn() * 8)
            pieces.spawn(b.piece, pos: SIMD3(c4.x, c4.y, c4.z), quat: q, v: bv, w: bw)
            if b.source == .wing { car.keepTornWing() }   // crash.js syncPose: the wing flies in the pose it left in
            brokenNow[b.group.rawValue] = true
        }
        for g in CarState.Group.allCases where brokenNow[g.rawValue] { car.broken[g.rawValue] = true }
    }
    // The lamps and the canopy (crash.js st).
    private var head: Float = 1, tail: Float = 1, headFail: Float = 0, tailFail: Float = 0, headDead = false, tailDead = false, hazardT: Float = -1, hazard = false, glass = false
    /// The run's first big hit: where, and the car's velocity (crash.js cutTo; the director places the camera).
    var cut: ((SIMD3<Float>, SIMD3<Float>) -> Void)?
    private var cutDone = false

    var onReset: (() -> Void)?
    func reset() {
        onReset?()
        cursor = 0; lastTick = -1; cutDone = false; slowK = 1; slowT = 0; ventT = 0; grind = 0; bigT = -10; flashT = 0
        head = 1; tail = 1; headFail = 0; tailFail = 0; headDead = false; tailDead = false; hazardT = -1; hazard = false; glass = false
        pieces.reset(); car.reset()
        for j in 0..<Crash.NS { sLife[j] = 0 }
        for j in 0..<Crash.NC { cLife[j] = 0 }
        for j in 0..<Crash.NM { mLife[j] = 0; mAlpha[j] = 0 }
    }

    private func spark(_ p: SIMD3<Float>, _ v: SIMD3<Float>, _ heat: Float, _ life: Float) {
        let j = sHead; sHead = (sHead + 1) % Crash.NS
        sPos[j] = p; sVel[j] = v; sLife[j] = 1; sHeat[j] = heat; sDecay[j] = 1 / life
    }
    private func chip(_ p: SIMD3<Float>, _ v: SIMD3<Float>, _ size: Float, _ hex: UInt32, _ flat: Bool) {
        let j = cHead; cHead = (cHead + 1) % Crash.NC
        cPos[j] = p; cVel[j] = v
        let q = simd_normalize(SIMD4<Float>(sgn(), sgn(), sgn(), sgn() + 0.01))
        cRot[j] = simd_quatf(vector: q)
        cSpin[j] = SIMD3(sgn() * 22, sgn() * 22, sgn() * 22)
        cScale[j] = SIMD3(size * (0.6 + rnd()), size * (flat ? 0.12 : 0.5 + rnd() * 0.6), size * (0.6 + rnd()))
        cLife[j] = 4 + rnd() * 3
        cColor[j] = srgbHexToLinear(hex)
    }
    private func puff(_ p: SIMD3<Float>, _ v: SIMD3<Float>, _ size: Float, _ grow: Float, _ life: Float, _ alpha: Float, _ c: SIMD3<Float>) {
        let j = mHead; mHead = (mHead + 1) % Crash.NM
        mPos[j] = p; mVel[j] = v; mLife[j] = 1; mDecay[j] = 1 / life; mSize0[j] = size; mGrow[j] = grow; mAlpha0[j] = alpha; mCol[j] = c
    }

    /// A puff from outside a crash (Free Drive's tyre smoke, dust and spray, 0221): the same pool, the same draw.
    func kick(_ p: SIMD3<Float>, _ v: SIMD3<Float>, size: Float, grow: Float, life: Float, alpha: Float, color: SIMD3<Float>) {
        puff(p, v, size, grow, life, alpha, color)
    }
    /// The car made whole again (Free Drive's reset): dents out, lamps back, parts back on. The events already drawn
    /// stay drawn (unlike reset, which would replay them).
    func repair() {
        onReset?()
        head = 1; tail = 1; headFail = 0; tailFail = 0; headDead = false; tailDead = false; hazardT = -1; hazard = false; glass = false
        pieces.reset(); car.reset(); grind = 0; slowK = 1; slowT = 0
    }

    /// Feed events up to `tick` (the replay's frame).
    func feed(_ imps: [Replay.Impact], tick: Int, vel: SIMD3<Float>, carPos: SIMD3<Float>, carQuat: simd_quatf) {
        if tick < lastTick { reset() }   // the replay looped
        lastTick = tick
        carVel = vel; self.carPos = carPos; self.carQuat = carQuat
        tailPos = carQuat.act(SIMD3(0, 0.1, -1.7)) + carPos; carUp = carQuat.act(SIMD3(0, 1, 0))
        while cursor < imps.count && imps[cursor].tick <= tick {
            let i = cursor; cursor += 1
            if tick - imps[i].tick > 120 && imps[i].kind != ImpactKind.CRUSH { continue }
            onEvent(imps[i])
        }
    }
    private var tailPos = SIMD3<Float>(), carUp = SIMD3<Float>(0, 1, 0)

    let log = Launch.args.contains("-crash-log")
    private func onEvent(_ e: Replay.Impact) {
        let kind = e.kind, part = e.part, v = e.speed
        if log { print(String(format: "CRASH tick %d %@ part %d %.1f m/s at (%.1f, %.1f, %.1f)%@", e.tick, ["hit", "scrape", "wheel", "crush"][Int(min(3, kind))], part, v, e.pos.x, e.pos.y, e.pos.z, e.body >= 0 ? " on parked \(e.body)" : "")) }
        let p = e.pos, n = e.normal
        reseed(e.tick, Int(e.probe) + Int(kind) * 37)
        let vn = simd_dot(carVel, n), t = carVel - vn * n
        let onGround = e.body < 0
        if kind == ImpactKind.SCRAPE {
            if v < 3 { return }
            let count = part == PART.floor ? min(6, Int(jsRound(Double((v - 6) * 0.6)))) : min(7, Int(jsRound(Double((v - 2.5) * (onGround ? 0.7 : 0.35)))))
            if count > 0 { for _ in 0..<count {
                let s = 0.5 + rnd() * 0.9
                spark(SIMD3(p.x + sgn() * 0.15, p.y + 0.02, p.z + sgn() * 0.15),
                      SIMD3(t.x * s + n.x * (1 + rnd() * 3) + sgn() * 2, t.y * s + n.y * (1 + rnd() * 3) + rnd() * 2.5, t.z * s + n.z * (1 + rnd() * 3) + sgn() * 2), 0.7 + rnd() * 0.3, 0.35 + rnd() * 0.5)
            } }
            if part != PART.floor && onGround && rnd() < 0.6 { puff(SIMD3(p.x, p.y + 0.1, p.z), SIMD3(t.x * 0.3 + sgn(), 0.2 + rnd() * 0.5, t.z * 0.3 + sgn()), 0.5, 3.5, 1.6, 0.16, SIMD3(0.5, 0.49, 0.47)) }
            grind = max(grind, min(1, max(0, (v - 2.5) / 9)))
            return
        }
        if kind == ImpactKind.WHEEL {
            let sev = min(1, max(0, (v - 3) / 7))
            var k: Float = 0
            while k < 6 + sev * 10 {
                let a = rnd() * .pi * 2, sp = 1.5 + rnd() * 3 * (0.5 + sev)
                puff(SIMD3(p.x + cos(a) * 0.2, p.y + 0.12, p.z + sin(a) * 0.2), SIMD3(cos(a) * sp + carVel.x * 0.3, 0.3 + rnd() * 0.8, sin(a) * sp + carVel.z * 0.3), 0.5, 4 + sev * 3, 1.6 + rnd(), 0.3, SIMD3(0.8, 0.8, 0.82))
                k += 1
            }
            if audible && v > 5 { Sound.shared.impact(speed: Double(v), part: .wheel, seed: e.tick * 31 + Int(e.probe)) }   // a landing's own thud is the game's touchdown
            if !reduced { shake?(min(1.2, 0.2 + sev)) }
            return
        }
        if kind == ImpactKind.CRUSH {
            // crash.js: folded far enough, the lamps in that end are gone; the skin dents at the probe, a struck car where it was hit.
            if part == PART.nose && e.crush > 0.06 && !headDead { headDead = true; headFail = max(headFail, 0.5) }
            if part == PART.tail && e.crush > 0.06 && !tailDead { tailDead = true; tailFail = max(tailFail, 0.5) }
            dentHero?(Int(e.probe), e.crush, n, Float(e.tick) * 0.37)
            if e.body >= 0 { dentParked?(Int(e.body), p, n, min(0.3, e.crush * 0.6), Float(e.tick) * 0.53) }
            return
        }
        // HIT
        if v < 1.6 { return }
        let sev = min(1, max(0, (v - 2) / 12))
        let ns = Int(jsRound(Double(10 + 34 * sev)))
        for _ in 0..<ns {
            let out = 1.5 + rnd() * 6 * (0.4 + sev), s = 0.3 + rnd() * 0.9
            spark(SIMD3(p.x, p.y + 0.02, p.z), SIMD3(t.x * s + n.x * out + sgn() * 3.5, t.y * s + n.y * out + rnd() * 3, t.z * s + n.z * out + sgn() * 3.5), 0.75 + rnd() * 0.25, 0.4 + rnd() * 0.7)
        }
        flashPos = p + n * 0.2; flashS = 0.35 + 0.9 * sev; flashT = 0.05 + 0.06 * sev
        let glassy = part == PART.roof || part == PART.side
        let nChip = Int(jsRound(Double((v > 4 ? 6 : 0) + 40 * sev)))
        for _ in 0..<nChip {
            let r = rnd()
            let hex: UInt32 = glassy && r < 0.55 ? (rnd() < 0.7 ? 0xf2ead8 : 0x8a6a44) : part == PART.nose || part == PART.tail ? (r < 0.5 ? 0x16171a : 0xe3e4e2) : r < 0.6 ? 0xe3e4e2 : 0x0c0d0f
            let pc = e.body >= 0 && rnd() < 0.4 ? (Int(e.body) < paints.count ? paints[Int(e.body)] : hex) : hex   // chips in the struck car's own colour
            let sp = 1 + rnd() * 3.5 * (0.4 + sev)
            chip(SIMD3(p.x + sgn() * 0.25, p.y + 0.05 + rnd() * 0.2, p.z + sgn() * 0.25),
                 SIMD3(carVel.x * 0.6 + n.x * sp + sgn() * 2, carVel.y * 0.2 + abs(n.y) * sp * 0.6 + 0.5 + rnd() * 2, carVel.z * 0.6 + n.z * sp + sgn() * 2),
                 glassy && r < 0.55 ? 0.008 + rnd() * 0.018 : 0.012 + rnd() * 0.035, pc, glassy && r < 0.55)
        }
        let nPuff = Int(jsRound(Double((onGround ? 4 : 2) + (onGround ? 18 : 5) * sev)))
        for _ in 0..<nPuff {
            let a = rnd() * .pi * 2, sp = 1 + rnd() * 4.5 * (0.4 + sev)
            let c: Float = onGround ? 0.46 + rnd() * 0.08 : 0.7
            puff(SIMD3(p.x + cos(a) * 0.3, p.y + 0.12, p.z + sin(a) * 0.3), SIMD3(cos(a) * sp + t.x * 0.25, 0.15 + rnd() * 0.8 * (0.4 + sev), sin(a) * sp + t.z * 0.25),
                 0.7, 5 + 6 * sev, 2.2 + rnd() * 1.8, onGround ? 0.2 + 0.12 * sev : 0.12, SIMD3(c, c * 0.97, c * 0.93))
        }
        // Parts tear off: the hardest-hit end loses what hangs off it. The canopy crazes when the roof or a shoulder takes it hard.
        tearOff(part, v, sev, n)
        if glassy && v > 6 && !glass { glass = true; car.crazed = true }
        // Lamps: the nose takes the headlamps with it, the tail the taillight; flicker, then out.
        if part == PART.nose && v > 4 { headFail = 0.7 + 0.8 * sev; headDead = headDead || sev > 0.25 }
        if part == PART.tail && v > 4 { tailFail = 0.6 + 0.6 * sev; tailDead = tailDead || sev > 0.35 }
        if sev > 0.6 && part != PART.floor { headFail = max(headFail, 0.6) }
        if sev > 0.2 && hazardT < 0 { hazardT = 0.9 }
        if sev > 0.55 { ventT = max(ventT, 1.1 + sev) }
        if e.body >= 0 { dentParked?(Int(e.body), p, n, min(0.14, 0.003 * v * v), Float(e.tick) * 0.29) }   // a dent; the sim rocks it on its springs
        if audible { Sound.shared.crunch(severity: Double(sev), glass: glassy && v > 5, seed: e.tick * 31 + Int(e.probe)) }
        if !reduced {
            shake?(min(2.6, 0.25 + v * 0.17))
            if v > 6.5 && clock - bigT > 2.5 {
                bigT = clock; slowT = 0.75 + 0.5 * sev
                if !cutDone { cutDone = true; cut?(p, carVel) }
            }
        }
    }

    /// Per rendered frame (real seconds; particles run on the slowed clock).
    func update(_ dtReal: Float) {
        clock += dtReal
        if slowT > 0 { slowT -= dtReal; slowK += (0.2 - slowK) * min(1, dtReal * 18) } else { slowK += (1 - slowK) * min(1, dtReal * 3.5) }
        if slowK > 0.995 { slowK = 1 }
        let dt = dtReal * slowK, fl: Float = 0
        let drag = exp(-dt * 1.2)
        for j in 0..<Crash.NS where sLife[j] > 0 {
            sLife[j] -= dt * sDecay[j]
            if sLife[j] <= 0 { sLife[j] = 0; continue }
            sVel[j].x *= drag; sVel[j].y = sVel[j].y * drag - G * dt; sVel[j].z *= drag
            sPos[j] += sVel[j] * dt
            if sPos[j].y < fl + 0.01 && sVel[j].y < 0 { sPos[j].y = fl + 0.01; sVel[j].y *= -0.35; sVel[j].x *= 0.7; sVel[j].z *= 0.7 }
        }
        for j in 0..<Crash.NC where cLife[j] > 0 {
            cLife[j] -= dt
            if cLife[j] <= 0 { continue }
            let rest = cPos[j].y <= cScale[j].y * 0.5 + 0.002 && abs(cVel[j].y) < 0.3 && abs(cVel[j].x) + abs(cVel[j].z) < 0.2
            if !rest {
                cVel[j].y -= G * dt
                cPos[j] += cVel[j] * dt
                let r = fl + cScale[j].y * 0.5
                if cPos[j].y < r { cPos[j].y = r; cVel[j].y *= -0.3; cVel[j].x *= 0.55; cVel[j].z *= 0.55; cSpin[j] *= 0.5 }
                let wl = simd_length(cSpin[j])
                if wl > 1e-4 { cRot[j] = simd_quatf(angle: wl * dt, axis: cSpin[j] / wl) * cRot[j] }
            }
        }
        if ventT > 0 {
            ventT -= dt
            let count = min(4, Int((dt * 120).rounded(.up)))
            for _ in 0..<max(0, count) {
                puff(tailPos + SIMD3(sgn() * 0.3, 0, 0), SIMD3(carUp.x * 3 + sgn() * 2.5, carUp.y * 3 + 1.5 + rnd() * 2, carUp.z * 3 + sgn() * 2.5), 0.35, 4.5, 1.3 + rnd(), 0.2 * min(1, ventT), SIMD3(0.9, 0.94, 0.98))
            }
        }
        let sd = exp(-dt * 2.2)
        for j in 0..<Crash.NM {
            if mLife[j] <= 0 { mAlpha[j] = 0; continue }
            mLife[j] -= dt * mDecay[j]
            mVel[j].x *= sd; mVel[j].y = mVel[j].y * sd + dt * 0.25; mVel[j].z *= sd
            mPos[j] += mVel[j] * dt
            if mPos[j].y < 0.1 { mPos[j].y = 0.1 }
            let age = 1 - max(0, mLife[j])
            mSize[j] = mSize0[j] + age * mGrow[j]
            mAlpha[j] = min(1, age * 9) * pow(max(0, mLife[j]), 1.3) * mAlpha0[j]
        }
        if flashT > 0 { flashT -= dtReal }
        // Torn-off parts: rigid boxes on the concrete.
        pieces.update(dt)
        // Lamps: flicker while failing, then out (or dimmed); hazards after a crash.
        if headFail > 0 { headFail -= dtReal; head = sin(clock * 61) * sin(clock * 23.3) > 0.1 ? 1 : 0.05; if headFail <= 0 { head = headDead ? 0 : 0.55 } }
        if tailFail > 0 { tailFail -= dtReal; tail = sin(clock * 47) * sin(clock * 17.1) > 0 ? 1 : 0.1; if tailFail <= 0 { tail = tailDead ? 0.04 : 0.6 } }
        if hazardT > 0 { hazardT -= dtReal; if hazardT <= 0 { hazard = true } }
        car.setDamage(head: head, tail: tail, hazard: hazard)
        grind *= exp(-dtReal * 5)
    }

    var liveCounts: (Int, Int, Int) { (sLife.filter { $0 > 0 }.count, mAlpha.filter { $0 > 0.002 }.count, cLife.filter { $0 > 0 }.count) }
    /// The live particles into the GPU's instance buffers; returns how many of each.
    func write(sparks: UnsafeMutablePointer<SparkGPU>, puffs: UnsafeMutablePointer<PuffGPU>, chips: UnsafeMutablePointer<ChipGPU>) -> (Int, Int, Int) {
        var ns = 0, nm = 0, nc = 0
        for j in 0..<Crash.NS where sLife[j] > 0 { sparks[ns] = SparkGPU(pos: SIMD4(sPos[j], sLife[j]), vel: SIMD4(sVel[j], sHeat[j])); ns += 1 }
        for j in 0..<Crash.NM where mAlpha[j] > 0.002 { puffs[nm] = PuffGPU(pos: SIMD4(mPos[j], mSize[j]), color: SIMD4(mCol[j], mAlpha[j])); nm += 1 }
        for j in 0..<Crash.NC where cLife[j] > 0 {
            let fade = min(1, cLife[j] / 0.6)
            chips[nc] = ChipGPU(pos: SIMD4(cPos[j], 0), rot: cRot[j].vector, scale: SIMD4(cScale[j] * fade, 0), color: SIMD4(cColor[j], 1)); nc += 1
        }
        return (ns, nm, nc)
    }
    var flash: (pos: SIMD3<Float>, size: Float, k: Float)? { flashT > 0 ? (flashPos, flashS * (1.3 - 0.3 * min(1, flashT / 0.1)), pow(min(1, flashT / 0.1), 2)) : nil }
}

func srgbHexToLinear(_ v: UInt32) -> SIMD3<Float> {
    func c(_ x: UInt32) -> Float { let s = Float(x) / 255; return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4) }
    return SIMD3(c((v >> 16) & 255), c((v >> 8) & 255), c(v & 255))
}
