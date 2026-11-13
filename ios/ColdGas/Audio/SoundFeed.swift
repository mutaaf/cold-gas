// What the sound hears (0250), read from state that already exists: the car's wheels (spin, slip, compression), the
// drive's chassis (motor torque, ABS), the jets' valves, the ground under the car, the world's props beside the road,
// the land's biome. It never writes the sim: a scored run's bits can't depend on anything here.
//
// Main thread, once a display frame: drive(_:dt:grind:) in Free Drive and the roams, run(_:course:dt:grind:) in a scored
// run, plain(...) in a replay. It also fires the one-shots whose cause it sees (a jet bank opening, the wheels leaving
// and meeting the ground, a corner over a bump, a pass-by) and keeps the ambience and the reverb zone current.
import Foundation
import ColdGasAudio
import simd
import ColdGasCore
import ColdGasPhysics
import ColdGasWorld

final class SoundFeed {
    static let shared = SoundFeed()

    /// The reduction from the rear wheels to the motors (ESTIMATE: 9:1, a common EV single-speed).
    static let ratio = 9.0

    private var prevComp = [Double](repeating: 0, count: 4), thumpT = [Double](repeating: -1, count: 4)
    private var bank = [0.0, 0.0], bankT = [-1.0, -1.0]
    private var airT = 0.0, wasAir = false, airVy = 0.0, landT = -10.0, clock = 0.0
    private var surf = (paved: 1.0, gravel: 0.0, grass: 0.0, wet: 0.0, concrete: 1.0)
    private var surfT = 0.0, ambT = 0.0, birdT = 2.0, seed = 1
    private var prevPos = SIMD2<Double>(0, 0), passT = -1.0
    private var trees = 0.0, coast = 0.0
    private var cpuT = 0.0
    // The props near the car (pass-bys), streamed off the main thread from the world's own placement.
    private var cells: [Int64: [PropSolid]] = [:]
    private var asked = Set<Int64>()
    private var near: [(x: Double, y: Double, z: Double, kind: Int, mat: HitMaterial)] = []
    private var lastOrigin = SIMD3<Double>(0, 0, 0), onDeck = false
    private var nearT = 0.0
    private let queue = DispatchQueue(label: "coldgas.sound.props", qos: .utility)
    private weak var world: FreeWorld?
    /// Bumped when the world changes: a late answer from the old one is dropped.
    private var worldGen = 0
    /// False until the first frame after a reset has read the springs (no knock from a standing start).
    private var primed = false

    /// A fresh run or drive: nothing carries over.
    func reset() {
        for i in 0..<4 { prevComp[i] = 0; thumpT[i] = -1 }
        bank[0] = 0; bank[1] = 0; airT = 0; wasAir = false; airVy = 0; surfT = 0; ambT = 0; nearT = 0; near.removeAll(keepingCapacity: true)
        prevPos = .zero; primed = false; landT = -10
        lastOrigin = .zero; onDeck = false
    }

    // MARK: - Free Drive and the roams

    func drive(_ fd: FreeDrive, dt: Double, grind: Double) {
        clock += dt
        let car = fd.car
        var c = carState(car, dt: dt)
        // The motors' torque (0225's chassis): + driving, − regen. The friction brakes blend with regen at speed.
        if fd.ownCar {
            let t = (fd.chassis.driveT[2] + fd.chassis.driveT[3]) / (2 * SPEC.maxWheelTorque)
            var ld = t > 0 ? min(1, t * 2.2) : max(-1, t * 6)
            if fd.pedal > 0.05 && c.speed > 2 { ld = min(ld, -0.3 - 0.6 * fd.pedal) }
            c.load = ld
            c.abs = fd.chassis.absActive ? 1 : 0
        } else {
            c.load = fd.pedal > 0.05 ? -0.5 : c.speed > 1 ? 0.3 : 0
        }
        c.rough = fd.roughK
        c.grind = grind
        // The ground under the car, ten times a second.
        surfT -= dt
        if surfT <= 0 {
            surfT = 0.1
            let g = fd.world.ground(car.pos.x, car.pos.z)
            let floor = g.floor || Site.onFloor(car.pos.x, car.pos.z)
            let was = surf.wet
            surf = floor ? (1, 0, 0, 0, 1) : surfaceMix(g.surface)
            if was < 0.5 && surf.wet > 0.5 && c.speed > 4 { Sound.shared.splash(min(1, c.speed / 20), seed: nextSeed()) }
        }
        c.paved = surf.paved; c.gravel = surf.gravel; c.grass = surf.grass; c.wet = surf.wet; c.concrete = surf.concrete
        c.deck = car.onWall ? 1 : 0
        lastOrigin = fd.origin; onDeck = car.onWall
        // A landing out in the world (the scored runs have their own touchdown).
        let landed = air(car, &c, dt: dt)
        if landed > 0 {
            Sound.shared.land(sink: landed, paved: surf.paved, seed: nextSeed())
            let k = Float(min(1, landed / 6))
            HapticPlayer.shared.play(HapticEvent(kind: .wheel, tick: 0, channel: 4, intensity: 0.25 + 0.7 * k, sharpness: 0.4))
        }
        jets(car)
        suspension(car, dt: dt)
        Sound.shared.drive(c)

        // The world round the listener: twice a second.
        ambT -= dt
        if ambT <= 0 {
            ambT = 0.5
            let g = fd.world.ground(car.pos.x, car.pos.z)
            let onSet = Site.onFloor(car.pos.x, car.pos.z)
            let w = g.land.w
            trees = onSet ? 0 : min(1, w.3 * 1.1 + w.0 * 0.6)
            coast = onSet ? 0 : w.1
            let d = (car.pos.x * car.pos.x + car.pos.z * car.pos.z).squareRoot()
            let crowd = d < 900 ? 0.8 : max(0, 0.8 - (d - 900) / 900)
            Sound.shared.ambience(trees: trees, crickets: 0.55 * (1 - 0.5 * w.2), breeze: 0.4 + 0.4 * coast + 0.3 * w.0, crowd: crowd)
            Sound.shared.zone(zoneAt(fd, car, trees: trees, onSet: onSet && d < 450))
            if world !== fd.world { world = fd.world; worldGen += 1; cells.removeAll(); asked.removeAll() }
            streamProps(car.pos.x, car.pos.z)
        }
        let o = fd.origin
        Sound.shared.placeCrowd(at: SIMD3<Float>(Float(-28 - o.x), 5, Float(12 - o.z)))
        birds(dt: dt)
        passbys(car, origin: o, dt: dt, parked: car.world.bodies)
        meterLog(dt)
    }

    // MARK: - A scored run (and its aftermath)

    func run(_ l: LiveRun, course: String, dt: Double, grind: Double, done: Bool) {
        clock += dt
        let car = l.run.car
        var c = carState(car, dt: dt)
        let th = done ? 0 : l.input.throttle, br = done ? 1 : l.input.brake
        c.load = th > 0.02 ? th : c.speed > 2 ? -(0.25 + 0.6 * br) : 0
        c.grind = grind
        c.paved = 1; c.concrete = 1; c.deck = car.onWall || (course == "wall" && car.pos.y > 0.4 && car.grounded > 0) ? 1 : 0
        if c.deck > 0 { c.concrete = 0 }
        lastOrigin = .zero; onDeck = c.deck > 0; surf = (1, 0, 0, 0, 1)
        _ = air(car, &c, dt: dt)   // the touchdown itself is the Game's (it knows the sink the judges use)
        if done { c.lift = 0; c.side = 0 } else { jets(car) }
        suspension(car, dt: dt)
        Sound.shared.drive(c)
        ambT -= dt
        if ambT <= 0 {
            ambT = 0.5
            Sound.shared.ambience(trees: 0, crickets: 0.35, breeze: 0.3, crowd: 0.6)
            Sound.shared.zone(.set)
        }
        Sound.shared.placeCrowd(at: SIMD3<Float>(-28, 5, 12))
        passbys(car, origin: .zero, dt: dt, parked: car.world.bodies, props: false)
        meterLog(dt)
    }

    /// A replay from its track (no wheels to read): speed, jets, on the ground or not.
    func plain(speed: Double, throttles: [Double], grounded: Bool, phase: Sound.Phase = .run) {
        lastOrigin = .zero; onDeck = false; near.removeAll(keepingCapacity: true)
        var lift = 0.0, side = 0.0
        for i in 0..<throttles.count { if i < 4 { lift += throttles[i] } else { side += throttles[i] } }
        burstEdges(lift: lift, side: side)
        Sound.shared.update(speed: speed, lift: lift, side: side, grounded: grounded, phase: phase)
        Sound.shared.ambience(trees: 0, crickets: 0.35, breeze: 0.3, crowd: phase == .run ? 0.6 : 0)
    }

    /// The title or a pause: the beds settle.
    func quiet(title: Bool) {
        Sound.shared.update(speed: 0, lift: 0, side: 0, grounded: true, phase: title ? .title : .quiet)
        Sound.shared.ambience(trees: 0, crickets: title ? 0.25 : 0, breeze: title ? 0.25 : 0, crowd: 0)
        bank[0] = 0; bank[1] = 0
    }

    // MARK: - The car

    private func carState(_ car: Vehicle, dt: Double) -> CarAudio {
        var c = CarAudio()
        let v = car.vel
        c.speed = DMath.dhypot(v.x, v.y, v.z)
        let w2 = car.wheels[2].omega, w3 = car.wheels[3].omega
        let spin = abs(w2 + w3) / 2 / (2 * .pi)
        c.spinHz = spin
        c.motorHz = abs(w2) / (2 * .pi) * SoundFeed.ratio
        c.split = abs(w2) > 1 ? min(1.05, max(0.95, abs(w3) / abs(w2))) : 1
        c.grounded = Double(car.grounded) / 4
        // Squeal from the tyres' slip past their peaks (the friction circle the chassis works on).
        var slip = 0.0, long = 0.0, lat = 0.0
        for i in 0..<4 {
            let w = car.wheels[i]
            guard w.contact else { continue }
            let ls = max(0, (abs(w.slip) - 0.1) / 0.25), as_ = max(0, (abs(w.slipAngle) - 0.07) / 0.16)
            let gate = c.speed > 2.5 || abs(w.omega) > 8 ? 1.0 : c.speed / 2.5
            slip = max(slip, min(1, max(ls, as_)) * gate)
            long = max(long, ls); lat = max(lat, as_)
        }
        c.slip = slip; c.slipLong = long > lat ? 1 : 0
        var lift = 0.0, side = 0.0
        for i in 0..<car.throttles.count { if i < 4 { lift += car.throttles[i] } else { side += car.throttles[i] } }
        c.lift = lift; c.side = side
        return c
    }

    /// Airborne bookkeeping: the whoosh as the wheels leave; returns the sink rate when it comes down after ≥ 0.3 s.
    private func air(_ car: Vehicle, _ c: inout CarAudio, dt: Double) -> Double {
        let up = car.grounded == 0 && !car.hullContact
        var sink = 0.0
        if up {
            airT += dt
            airVy = car.vel.y
            if airT > 0.12 && !wasAir { wasAir = true; if c.speed > 6 { Sound.shared.airborne(speed: c.speed) } }
        } else {
            if wasAir && airT > 0.3 { sink = max(0, -airVy); landT = clock }
            airT = 0; wasAir = false
        }
        c.air = wasAir ? 1 : 0
        return sink
    }

    private func jets(_ car: Vehicle) {
        var lift = 0.0, side = 0.0
        for i in 0..<car.throttles.count { if i < 4 { lift += car.throttles[i] } else { side += car.throttles[i] } }
        burstEdges(lift: lift, side: side)
    }
    /// A bank opening from shut is a burst; shutting is the valve seating.
    private func burstEdges(lift: Double, side: Double) {
        for b in 0..<2 {
            let lvb = b == 0 ? lift : side, full = b == 0 ? 2.5 : 3.0
            if lvb > 0.25 && bank[b] < 0.08 && clock - bankT[b] > 0.12 {
                bankT[b] = clock
                Sound.shared.burst(bank: b, k: min(1, lvb / full), seed: nextSeed())
            } else if lvb < 0.05 && bank[b] > 0.3 {
                Sound.shared.valveClose(bank: b, k: min(1, bank[b] / full), seed: nextSeed())
            }
            bank[b] = lvb
        }
    }

    /// A corner whose spring is struck fast (a bump, a kerb, a rut): a knock on that side.
    private func suspension(_ car: Vehicle, dt: Double) {
        guard dt > 0 else { return }
        if !primed { primed = true; for i in 0..<4 { prevComp[i] = car.wheels[i].compression }; return }
        for i in 0..<4 {
            let w = car.wheels[i]
            let rate = (w.compression - prevComp[i]) / dt
            prevComp[i] = w.compression
            guard w.contact, clock - landT > 0.3, clock - thumpT[i] > 0.09 else { continue }
            if rate > 0.8 {
                thumpT[i] = clock
                Sound.shared.thump(min(1, (rate - 0.8) / 2.5), pan: WHEELS[i].x > 0 ? 1 : -1, seed: nextSeed())
            }
        }
    }

    private func surfaceMix(_ s: Surface) -> (paved: Double, gravel: Double, grass: Double, wet: Double, concrete: Double) {
        switch s {
        case .concrete: return (1, 0, 0, 0, 1)
        case .asphalt: return (1, 0, 0, 0, 0)
        case .gravel: return (0.15, 1, 0, 0, 0)
        case .rock: return (0.4, 0.8, 0, 0, 0)
        case .grass: return (0, 0.1, 1, 0, 0)
        case .dirt: return (0, 0.55, 0.6, 0, 0)
        case .sand: return (0, 0.2, 0.4, 0.5, 0)
        case .snow: return (0, 0.45, 0.2, 0.6, 0)
        case .water: return (0, 0, 0, 1, 0)
        }
    }

    // MARK: - The world round the listener

    private func zoneAt(_ fd: FreeDrive, _ car: Vehicle, trees: Double, onSet: Bool) -> Zone {
        if roofUnder(car.world.bodies, car.pos.x, car.pos.z) > car.pos.y + 1 { return .under }
        if onSet { return .set }
        // Walls both sides: the ground 25 m out each way well above the car.
        let q = car.quat
        let fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
        let l = max(1e-6, (fx * fx + fz * fz).squareRoot()), rx = fz / l, rz = -fx / l
        var walls = 0
        for d in [25.0, 45.0] {
            let a = fd.world.ground(car.pos.x + rx * d, car.pos.z + rz * d).y, b = fd.world.ground(car.pos.x - rx * d, car.pos.z - rz * d).y
            if a > car.pos.y + 8 && b > car.pos.y + 8 { walls += 1 }
        }
        if walls > 0 { return .canyon }
        return trees > 0.45 ? .forest : .open
    }

    /// Birdsong at dusk: sparse, from the trees round the listener (gulls on the coast).
    private func birds(dt: Double) {
        let rate = (0.04 + 0.22 * trees + 0.15 * coast)   // calls a second
        birdT -= dt * rate
        guard birdT <= 0 else { return }
        birdT = 0.5 + Double(nextSeed() % 1000) / 500
        let l = Sound.shared.listenerPos
        let a = Double(nextSeed() % 6283) / 1000, r = 14 + Double(nextSeed() % 2400) / 100
        let p = l + SIMD3<Float>(Float(cos(a) * r), Float(5 + Double(nextSeed() % 900) / 100), Float(sin(a) * r))
        let u = Double(nextSeed() % 1000) / 1000
        let kind = coast > 0.5 && u < 0.6 ? 1 : u < 0.25 ? 2 : 0
        Sound.shared.bird(kind: kind, at: p, seed: nextSeed())
    }

    /// The props of the 3×3 prop cells round the car, asked of the world off the main thread, kept while near.
    private func streamProps(_ x: Double, _ z: Double) {
        guard let w = world else { return }
        let gen = worldGen
        let C = PropSpec.cell, ci = Int((x / C).rounded(.down)), cj = Int((z / C).rounded(.down))
        var keep = Set<Int64>()
        for j in (cj - 1)...(cj + 1) { for i in (ci - 1)...(ci + 1) {
            let k = (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j)))
            keep.insert(k)
            if cells[k] == nil && !asked.contains(k) {
                asked.insert(k)
                queue.async { [weak self] in
                    let solids = w.props(i, j).solids
                    DispatchQueue.main.async { guard let s = self, s.worldGen == gen else { return }; s.cells[k] = solids; s.asked.remove(k) }
                }
            }
        } }
        for k in cells.keys where !keep.contains(k) { cells[k] = nil }
        // Within 40 m: the candidates for the next half second.
        near.removeAll(keepingCapacity: true)
        for (_, list) in cells {
            for s in list where abs(s.x - x) < 40 && abs(s.z - z) < 40 {
                let kind: Int
                let mat: HitMaterial
                switch s.kind {
                case .trunk: kind = 0; mat = .wood
                case .sign: kind = 1; mat = .sign
                case .rail: kind = 2; mat = .rail
                case .fence: kind = 1; mat = .wood
                case .boulder: kind = 0; mat = .stone
                }
                near.append((s.x, s.y + 1.0, s.z, kind, mat))
            }
        }
    }

    /// Something beside the car's path, about to be passed: its whoosh, timed to peak as it goes by.
    private func passbys(_ car: Vehicle, origin o: SIMD3<Double>, dt: Double, parked: [ParkedBody], props: Bool = true) {
        let p = SIMD2(car.pos.x, car.pos.z), v = SIMD2(car.vel.x, car.vel.z)
        let speed = simd_length(v)
        defer { prevPos = p }
        guard speed > 12, prevPos != .zero, clock - passT > 0.07 else { return }
        let vh = v / speed
        func check(_ x: Double, _ y: Double, _ z: Double, _ kind: Int, _ maxLat: Double) -> Bool {
            let r = SIMD2(x, z) - p, r0 = SIMD2(x, z) - prevPos
            let along = simd_dot(r, vh), along0 = simd_dot(r0, vh)
            let lat = abs(r.x * vh.y - r.y * vh.x)
            let dy = abs(y - car.pos.y)
            let dist = (lat * lat + dy * dy).squareRoot()
            guard lat < maxLat, dist < maxLat + 2 else { return false }
            let lead = 1.6 * max(1.5, dist)
            guard along0 > lead && along <= lead else { return false }
            Sound.shared.passby(kind: kind, at: SIMD3<Float>(Float(x - o.x), Float(y - o.y), Float(z - o.z)), speed: speed, dist: max(1.5, dist), seed: nextSeed())
            passT = clock
            return true
        }
        for b in parked { if check(b.cx, b.cy + 0.8, b.cz, 3, 5) { return } }
        guard props else { return }
        for n in near { if check(n.x, n.y, n.z, n.kind, n.kind == 2 ? 6 : 7) { return } }
    }

    /// What's at `p` (render space) for a hit that didn't strike a car: the nearest prop within 2.5 m, else the ground
    /// under the car (the stage's concrete, the Wall's steel, the land).
    func material(at p: SIMD3<Float>) -> HitMaterial {
        let x = Double(p.x) + lastOrigin.x, z = Double(p.z) + lastOrigin.z
        var best = 6.25, m: HitMaterial? = nil
        for n in near {
            let d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z)
            if d < best { best = d; m = n.mat }
        }
        if let m { return m }
        if onDeck { return .rail }
        return surf.paved > 0.5 ? .stone : .earth
    }

    private func nextSeed() -> Int { seed = (seed &* 1103515245 &+ 12345) & 0x7fffffff; return seed }

    /// `-sound-cpu`: the render callbacks' cost every 5 s.
    private func meterLog(_ dt: Double) {
        guard Launch.args.contains("-sound-cpu") else { return }
        cpuT += dt
        if cpuT >= 5 {
            cpuT = 0
            let m = Sound.shared.cpu()
            print(String(format: "SOUND cpu %.2f%% of a core (render callbacks), worst block %.0f µs, %llu callbacks", m.percent, m.worstUs, m.blocks))
        }
    }
}
