// MATTER in a drive (0330–0333, docs/NATIVE-MATTER.md): what each wheel does to the ground and takes from it, and what
// each hit does to the car, once a frame (the ground) and once a tick (the hits). Unscored.
//   ground ← car   a stroke into the ground's memory where a loaded wheel crosses soft ground (TraceField): a rut as deep as
//                  that ground gives (deeper under load, deeper still spinning), a berm beside it, grass laid down, snow packed
//   car ← ground   the coat (CarDirt) from each wheel's metres on what it rolled; what's thrown up by kind and colour (clods
//                  of mud, stones, cut grass, snow powder) as tumbling bits in the crash's chip pool, on top of the dust and
//                  spray FreeDrive already kicks; water rinses the coat (WATER's wetness, or a ford's)
//   car ← hits     CarDamage from the sim's own impacts, tick by tick; the chassis reads its toe (a bent arm pulls) and its
//                  power (a wrecked unit limps). A shattered canopy is heard and felt; the cue says what changed.
// Nothing is allocated per frame (fixed arrays; the trace's queue is reserved).
import Foundation
import simd
import Metal
import ColdGasCore
import ColdGasPhysics
import ColdGasWorld
import ColdGasAudio

extension FreeDrive {
    /// How wet the car is (0…1): WATER's (rain, a lake) when it says, else the last ford's, draining.
    var wetness: Double {
        let w = wetSource?() ?? 0
        return max(w.isFinite ? min(1, max(0, w)) : 0, fordWet)
    }

    private func mrnd() -> Float { matterSeed ^= matterSeed << 13; matterSeed ^= matterSeed >> 17; matterSeed ^= matterSeed << 5; return Float(matterSeed) / Float(UInt32.max) }

    /// The ticks' new impacts into the car's damage, and what changed felt and said.
    func absorbImpacts() {
        let im = car.impacts
        if impSeen > im.count { impSeen = 0 }
        guard impSeen < im.count else { return }
        let was = damage
        let q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w).inverse
        while impSeen < im.count {
            let i = impSeen; impSeen += 1
            let d = q.act(SIMD3(Double(im.x[i]) - car.pos.x, Double(im.y[i]) - car.pos.y, Double(im.z[i]) - car.pos.z))
            let n = q.act(SIMD3(Double(im.nx[i]), Double(im.ny[i]), Double(im.nz[i])))
            damage.apply(kind: im.kind[i], part: im.part[i], local: (d.x, d.y, d.z), nLocal: (n.x, n.y, n.z), speed: Double(im.speed[i]),
                         crush: Double(im.crush[i]), wheel: Int(im.probe[i]))
        }
        if damage == was { return }
        if damage.glass == .shattered && was.glass != .shattered {
            Sound.shared.crunch(severity: 1, glass: true, seed: damage.hits &* 31)
            HapticPlayer.shared.play(HapticEvent(kind: .hit, tick: 0, channel: 4, intensity: 0.9, sharpness: 0.95))
            announce("The canopy's gone"); Signs.event("glass-shattered")
        } else if damage.powerK < 1 && was.powerK >= 1 {
            announce("Limping: the drive unit's hurt")
        } else if abs(damage.pull) > 0.008 && abs(was.pull) <= 0.008 {
            announce("An arm's bent: it pulls")
        }
    }

    /// One wheel on its ground this frame: its stroke, its coat, what it throws. `ground`: the patch (world metres), `rp`
    /// the same in render space; `slide` 0…1.
    func matterWheel(_ i: Int, _ w: Wheel, _ matter: GroundMatter, at ground: SIMD3<Double>, rp: SIMD3<Float>, side: SIMD3<Double>,
                     fwd: SIMD3<Double>, v: SIMD3<Double>, speed: Double, slide: Double, crash: Crash) {
        if crash.ground == nil {
            // The crash's particles land on the world's ground, not on y = 0 (render space in, render space out).
            crash.ground = { [weak self] p in
                guard let self else { return 0 }
                let x = Double(p.x) + self.origin.x, z = Double(p.z) + self.origin.z
                if abs(x) < ColdGasWorld.Site.half && abs(z) < ColdGasWorld.Site.half { return Float(-self.origin.y) }
                let g = self.world.ground(x, z)
                return Float((g.floor ? 0 : g.y) - self.origin.y)
            }
        }
        let p = SIMD2(ground.x, ground.z)
        let spin = min(1, abs(w.slip).isFinite ? abs(w.slip) : 0)
        // The ground's memory.
        if matter.soft, let t = trace {
            if let a = strokeAt[i] {
                let d = simd_distance(a, p)
                if d >= 0.3 {
                    if d < 6 {
                        let load = max(0.3, min(2, w.load / DriveSpec.staticLoad(i)))
                        let rut = matter.rut
                        let depth = rut.pass / TraceSpec.depthScale * load * (1 + 1.5 * spin)
                        let berm = depth * (matter == .grass ? 0.2 : matter == .mud ? 1.0 : 0.6)
                        let press = matter.flattens ? 0.55 : matter == .snow ? 0.5 : 0.15
                        t.stroke(from: a, to: p, halfWidth: 0.122, depth: depth, berm: berm, press: press, cap: rut.max / TraceSpec.depthScale, matter: matter)
                    }
                    strokeAt[i] = p
                }
            } else { strokeAt[i] = p }
        } else { strokeAt[i] = nil }
        // The coat: this wheel's metres on this ground.
        if let a = rolledAt[i] {
            // (metres counted from the last point it was counted at, so a crawl's few centimetres a frame still add up)
            let d = simd_distance(a, p)
            if d >= 0.25 {
                if d < 6 { dirt.roll(wheel: i, on: matter, dist: d, slip: spin, forward: simd_dot(v, fwd) >= 0) }
                rolledAt[i] = p
            }
        } else { rolledAt[i] = p }
        // What it throws: by kind, more with speed and far more spinning. Thrown back off the tread and up.
        let tread = abs(w.omega * (i < 2 ? SPEC.wheelRadiusFront : SPEC.wheelRadiusRear))
        guard tread > 3 || speed > 3 else { return }
        let rate: Double
        let hex: UInt32, size: Float, flat: Bool
        switch matter.roost {
        case .clods: rate = min(30, tread * 0.9) * (0.25 + spin); hex = 0x3b2a1b; size = 0.04; flat = false
        case .stones: rate = min(16, tread * 0.5) * (0.15 + spin); hex = 0x77716a; size = 0.022; flat = false
        case .grass: rate = min(14, tread * 0.5) * (0.1 + spin * 1.5); hex = 0x4a5a26; size = 0.035; flat = true
        case .snow:
            // Powder off the tread: big soft puffs, white.
            clodAcc[i] += min(0.1, 1.0 / 60) * min(24, tread) * (0.3 + spin)
            while clodAcc[i] >= 1 {
                clodAcc[i] -= 1
                let pv = SIMD3<Float>(v * 0.3 - fwd * min(tread, 25) * 0.15) + SIMD3((mrnd() - 0.5) * 2, 1.4 + mrnd() * 1.6, (mrnd() - 0.5) * 2)
                crash.kick(rp + SIMD3(0, 0.12, 0), pv, size: 0.5 + mrnd() * 0.4, grow: 2.4, life: 1.6, alpha: 0.32, color: SIMD3(0.72, 0.75, 0.8))
            }
            return
        default: return
        }
        clodAcc[i] += min(0.1, 1.0 / 60) * rate
        while clodAcc[i] >= 1 {
            clodAcc[i] -= 1
            let back = SIMD3<Float>(-fwd * min(tread, 30) * (0.18 + 0.12 * Double(mrnd())))
            let pv = SIMD3<Float>(v * 0.55) + back + SIMD3((mrnd() - 0.5) * 2.4, 1.8 + mrnd() * 3.2, (mrnd() - 0.5) * 2.4)
            crash.fling(rp + SIMD3(0, 0.12, 0), pv, size: size * (0.6 + mrnd() * 0.9), color: hex, flat: flat, life: matter == .mud ? 6 : 2.5)
        }
    }
}

extension FreeDrive {
    /// 0334: where a trunk snapped, its splinters (pale heartwood), bark and a puff of dust off the break.
    func splinterBurst(_ crash: Crash) {
        let v = SIMD3<Float>(Float(car.vel.x), Float(car.vel.y), Float(car.vel.z))
        for p in splinters {
            let rp = SIMD3<Float>(p - origin)
            for k in 0..<28 {
                let pv = v * 0.35 + SIMD3((mrnd2() - 0.5) * 5, 1 + mrnd2() * 4, (mrnd2() - 0.5) * 5)
                crash.fling(rp + SIMD3(0, mrnd2() * 0.6, 0), pv, size: 0.03 + mrnd2() * 0.06, color: k % 3 == 0 ? 0x2a1e14 : 0xb8a07a, flat: k % 2 == 0, life: 5)
            }
            for _ in 0..<8 { crash.kick(rp, SIMD3((mrnd2() - 0.5) * 2, 0.6 + mrnd2(), (mrnd2() - 0.5) * 2), size: 0.6, grow: 3, life: 1.8, alpha: 0.18, color: SIMD3(0.42, 0.36, 0.28)) }
        }
        splinters.removeAll(keepingCapacity: true)
    }
    private func mrnd2() -> Float { matterSeed ^= matterSeed << 13; matterSeed ^= matterSeed >> 17; matterSeed ^= matterSeed << 5; return Float(matterSeed) / Float(UInt32.max) }
}

#if DEBUG
extension FreeDrive {
    /// Shots and checks (Debug): `-fd-wet <0…1>` stands in for the WATER track's rain (soaked dirt and grass are mud, roads
    /// are wet); `-fd-wreck` puts a wreck's hits into the car 1 s after the world is built (a hanging nose panel, the canopy
    /// shattered, a bent front arm, the drive unit smoking).
    func matterDebug(_ dt: Double) {
        if wetSource == nil, let w = Launch.value("-fd-wet").flatMap(Double.init) { wetSource = { w } }
        guard Launch.args.contains("-fd-wreck"), view?.settled == true, damage.hits == 0 else { return }
        wreckT += dt
        guard wreckT > 1 else { return }
        for (part, x, z, v) in [(PART.nose, 0.4, 2.0, 6.0), (PART.side, -0.9, AXLE_F, 9.0), (PART.roof, 0.0, 0.0, 12.0), (PART.tail, 0.2, -2.0, 15.0), (PART.side, 0.9, -0.5, 15.0)] {
            damage.apply(kind: ImpactKind.HIT, part: part, local: (x, 0.2, z), speed: v)
        }
    }
}
#endif

extension TraceField {
    /// What the terrain binds when there's no trace: a one-texel array and an empty table.
    static func dummy(device: MTLDevice) -> (MTLTexture, [UInt8])? {
        let d = MTLTextureDescriptor()
        d.textureType = .type2DArray; d.pixelFormat = .rgba8Unorm; d.width = 1; d.height = 1; d.arrayLength = 1; d.usage = .shaderRead
        guard let t = device.makeTexture(descriptor: d) else { return nil }
        return (t, [UInt8](repeating: 0, count: TraceField.tableSize))
    }
}
