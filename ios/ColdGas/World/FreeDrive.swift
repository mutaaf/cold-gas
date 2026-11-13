// FREE DRIVE on the iPhone (docs/NATIVE-FREEDRIVE.md): the Show's apron at the centre of a world with no edge. Unscored:
// nothing here reaches a score, a log, the board or a medal.
//
// This object owns the drive's world (ColdGasWorld, pure), its view (WorldView), the camera and the floating origin, and
// hands the renderer what it draws through `DriveScene`. The car is the scored Swift car; in a cruise (`-fd-cruise`, the
// bench, the shots) it's carried along the roads at a set speed rather than stepped.
import Foundation
import Metal
import simd
import ColdGasCore
import ColdGasPhysics
import ColdGasWorld

/// What the renderer asks of a drive (Renderer.drive): the lens, the origin, the look, and the world's draw.
protocol DriveScene: AnyObject {
    /// World metres the frame is drawn relative to (0 near the centre, so the stage's own lights and glints stay put).
    var origin: SIMD3<Double> { get }
    /// The view and lens this frame (render space), after the world has chosen its tiles for it.
    func frameCamera(aspect: Float, dt: Double) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>)
    /// The drive's sky and air over the stage's.
    func look(over base: LookU) -> LookU
    /// The world, in the main pass, after the stage's opaque draws.
    func drawWorld(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, viewProj: simd_float4x4)
}

final class FreeDrive: DriveScene {
    static let seedDefault = "cold gas"
    #if DEBUG
    static let hold: (Double, Double, Double)? = {
        guard let a = Launch.value("-fd-hold")?.split(separator: ",").compactMap({ Double($0) }), a.count >= 2 else { return nil }
        return (a[0], a[1], a.count > 2 ? a[2] : 0)
    }()
    #endif
    let world: FreeWorld
    let camera = DriveCamera()
    private(set) var view: WorldView?
    private(set) var origin = SIMD3<Double>(0, 0, 0)
    /// The car: the scored machine on DRIVE_COURSE (the Show's stage at the centre) or a roam's course (0220: the Wall's
    /// or the Lineup's set there instead), its world streamed round it.
    private(set) var car: Vehicle
    /// The course the drive stands on ("drive", "drive-wall", "drive-lineup") and the scored course whose set that is.
    let course: Course
    var stage: String { stageOf(course.id) }
    let streamer: DriveStreamer
    let track: Replay
    /// The controls (Controls routes the touches here while the drive is up): src/input.js sample, the Standard hands.
    let sampler = InputSampler(level: .standard)
    private let input = Input()
    /// A cruise (the shots): carried along the roads at this speed (m/s), not stepped.
    var cruise: Double?
    /// The autopilot (the bench): a road-following driver at this speed (m/s), as src/drive/pilot.js.
    var pilot: Double?
    /// The suction fan, armed or not (the web's X).
    var fan = false
    private var walker: RoadWalker?
    private var time = 0.0, acc = 0.0, airT = 0.0, flipT = 0.0, stuckT = 0.0, reverseHeld = 0.0
    private(set) var dist = 0.0, resets = 0
    private var lampK = Launch.args.contains("-fd-nolamp") ? 0.0 : 1.0
    /// A reset's cue for the HUD ("Back on the road"), and when it was given.
    private(set) var cue = "", cueT = -10.0

    /// `onMark`: on the scored course's own mark, facing down its run (Roam, 0220); otherwise Free Drive's start on the
    /// apron, facing out.
    init(seed: String = FreeDrive.seedDefault, course: Course = DRIVE_COURSE, onMark: Bool = false) {
        world = FreeWorld(seed: seed)
        streamer = DriveStreamer(world: world)
        self.course = course
        track = Replay(live: course.id)
        car = createVehicle(course: course)
        car.world.streamer = streamer
        if onMark, let c = COURSES[stageOf(course.id)] { place(x: c.startX, z: c.startZ, yaw: 0) }
        else { place(x: course.startX, z: course.startZ, yaw: course.id == "drive-lineup" ? 0 : .pi) }
    }

    /// The car at (x, z) on the ground, facing `yaw` (0 = +z), at rest, everything let go (input.js freshRun).
    func place(x: Double, z: Double, yaw: Double) {
        let g = world.ground(x, z)
        car.pos.x = x; car.pos.y = g.y + SPEC.comHeight + 0.04; car.pos.z = z
        M3.quatFromYaw(car.quat, yaw)
        for v in [car.vel, car.angVel, car.angMom] { v.x = 0; v.y = 0; v.z = 0 }
        car.engineHeld = false
        sampler.freshRun()
        airT = 0; flipT = 0; stuckT = 0; reverseHeld = 0
        camera.snap()
        rebase(force: true)
        walker = nil
    }
    /// Onto the road nearest (x, z) (in the right-hand lane), heading `away` from the centre or along (hx, hz).
    func placeOnRoad(nearX x: Double, z: Double, heading: (Double, Double)? = nil) {
        let l = max(1e-9, (x * x + z * z).squareRoot())
        let h = heading ?? (x / l, z / l)
        guard let w = RoadWalker(world: world, nearX: x, z: z, headingX: h.0, z: h.1) else { return }
        let p = w.pose(lane: 1.8)
        place(x: p.x, z: p.z, yaw: atan2(p.hx, p.hz))
        walker = w
    }
    /// Back on the nearest road, facing the way the car was going (src/drive/index.js respawn).
    func reset() {
        let f = forward
        let moving = abs(car.vel.x) + abs(car.vel.z) > 2
        placeOnRoad(nearX: car.pos.x, z: car.pos.z, heading: moving ? (car.vel.x, car.vel.z) : (f.0, f.1))
        resets += 1
        say("Back on the road")
    }
    private func say(_ s: String) { cue = s; cueT = time }
    private var forward: (Double, Double) {
        let q = car.quat
        return (2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    }

    /// The renderer attached (its device): the world's view is built once.
    func attach(device: MTLDevice) {
        if view == nil { view = WorldView(device: device, world: world) }
        view?.origin = origin   // the drive may have moved its origin before the view existed
    }

    // MARK: - The frame (Game.frame, before the draw)

    func frame(dt: Double) {
        time += dt
        if let v = cruise { cruiseFrame(v, dt) }
        else {
            acc += min(dt, 0.1)
            do {
                while acc >= DT {
                    let air = car.grounded == 0 && !car.hullContact
                    airT = air ? airT + DT : 0
                    let phase: Phase = airT > 0.25 ? .air : .drive
                    sampler.sample(phase, .assist, input, false, car)
                    if let v = pilot { drivePilot(v, input) }
                    #if DEBUG
                    // `-fd-hold throttle,steer[,after s]`: a held throttle and steer (shots: a run into the row, a slide).
                    if let h = FreeDrive.hold, time >= h.2 { input.throttle = h.0; input.steer = h.1; input.brake = 0 }
                    #endif
                    input.fan = fan ? 1 : 0
                    if phase == .drive { reverse(input) }
                    try step(car, input)
                    // Unscored, so the tanks top up on the ground (a full charge in 8 s): the jets always work on a roam.
                    if car.grounded > 0 { car.air = min(CAR.airMass, car.air + CAR.airMass * DT / 8) }
                    track.append(car: car, origin: origin)
                    acc -= DT
                    rebase()
                }
            } catch { print("DRIVE sim stopped: \(error)"); reset() }
            watchdog(dt)
        }
        track.trim(keep: 16)
        dist = (car.pos.x * car.pos.x + car.pos.z * car.pos.z).squareRoot()
    }
    /// The renderer's clock for the track: one tick behind the newest, between it and the one before (main.js liveStep).
    var liveTime: Double {
        if cruise != nil { return Double(max(0, track.ticks - 1)) / Replay.hz }
        return (Double(max(0, track.ticks - 2)) + min(1, acc / DT)) / Replay.hz
    }

    private func cruiseFrame(_ v: Double, _ dt: Double) {
        if walker == nil { let f = forward; walker = RoadWalker(world: world, nearX: car.pos.x, z: car.pos.z, headingX: f.0, z: f.1) }
        guard let w = walker else { return }
        w.advance(v * dt)
        let p = w.pose(lane: 1.8)
        car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight; car.pos.z = p.z
        M3.quatFromYaw(car.quat, atan2(p.hx, p.hz))
        car.vel.x = p.hx * v; car.vel.y = 0; car.vel.z = p.hz * v
        rebase()
        track.append(car: car, origin: origin)
    }

    /// src/hands.js createReverse: the brake held at a standstill backs the car up (after 0.35 s still).
    private func reverse(_ i: Input) {
        let f = forward, vf = car.vel.x * f.0 + car.vel.z * f.1
        if i.brake > 0 && i.throttle == 0 && vf < 0.8 {
            if vf < -0.3 || reverseHeld >= 0.35 { i.throttle = -0.35 * i.brake; i.brake = 0 } else { reverseHeld += DT }
        } else { reverseHeld = 0 }
    }
    /// The autopilot: pure pursuit on a point ahead along the road, the speed held under `v` and eased for the bend.
    private func drivePilot(_ v: Double, _ i: Input) {
        if walker == nil { let f = forward; walker = RoadWalker(world: world, nearX: car.pos.x, z: car.pos.z, headingX: f.0, z: f.1) }
        guard let w = walker else { return }
        // Keep the walker abreast of the car.
        for _ in 0..<4 {
            let p = w.pose(lane: 1.8), dx = car.pos.x - p.x, dz = car.pos.z - p.z
            let along = dx * p.hx + dz * p.hz
            if along > 0.5 { w.advance(min(along, 20)) } else { break }
        }
        let speed = (car.vel.x * car.vel.x + car.vel.z * car.vel.z).squareRoot()
        let look = 10 + speed * 0.7
        // A copy looks ahead; the walker itself stays abreast of the car.
        let probe = w.copy()
        probe.advance(look); let ahead = probe.pose(lane: 1.8); probe.advance(look); let far = probe.pose(lane: 1.8)
        let f = forward
        let tx = ahead.x - car.pos.x, tz = ahead.z - car.pos.z
        let cross = f.0 * tz - f.1 * tx, dot = f.0 * tx + f.1 * tz
        let ang = atan2(cross, dot)
        // How sharp the road turns between here and the far point: slow for it.
        let turn = abs(atan2(ahead.hx * far.hz - ahead.hz * far.hx, ahead.hx * far.hx + ahead.hz * far.hz))
        let want = min(v, max(9, v * (1 - turn * 1.6)))
        i.steer = max(-1, min(1, ang * 2.2))   // + = right (src/drive/pilot.js)
        i.throttle = speed < want ? min(1, (want - speed) * 0.35 + 0.15) : 0
        i.brake = speed > want + 2 ? min(1, (speed - want) * 0.15) : 0
    }

    /// Upside down, fallen, in the sea or stuck: back on the road (src/drive/index.js watchdog).
    private func watchdog(_ dt: Double) {
        let q = car.quat, upY = 1 - 2 * (q.x * q.x + q.z * q.z)
        let speed = (car.vel.x * car.vel.x + car.vel.y * car.vel.y + car.vel.z * car.vel.z).squareRoot()
        flipT = upY < 0.25 && speed < 4 && (car.grounded > 0 || car.hullContact) ? flipT + dt : 0
        if flipT > 2 { reset(); return }
        let g = world.ground(car.pos.x, car.pos.z)
        if car.pos.y < g.y - 30 || car.pos.y < SEA - 1 { reset(); return }
        let jets = car.throttles[0] + car.throttles[1] + car.throttles[2] + car.throttles[3]
        stuckT = speed < 0.6 && car.grounded == 0 && jets < 0.4 ? stuckT + dt : 0
        if stuckT > 3 { reset() }
    }

    /// The floating origin of the drawing: 0 near the centre, else the car's position snapped to a kilometre, moved when
    /// it's a kilometre off. (The engine's is the streamer's, in 16 m steps: World.ox/oz.)
    private func rebase(force: Bool = false) {
        let p = SIMD3(car.pos.x, 0, car.pos.z)
        let want: SIMD3<Double>
        if abs(p.x) < 2048 && abs(p.z) < 2048 { want = .zero }
        else if force || abs(p.x - origin.x) > 1024 || abs(p.z - origin.z) > 1024 || origin == .zero {
            want = SIMD3((p.x / 1024).rounded() * 1024, 0, (p.z / 1024).rounded() * 1024)
        } else { return }
        if want == origin { return }
        let d = want - origin
        origin = want
        view?.origin = want
        track.shift(by: d)
    }

    // MARK: - DriveScene

    func frameCamera(aspect: Float, dt: Double) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>) {
        // The camera follows the car as it's drawn (one tick behind, between ticks), not the newest tick.
        var p = SIMD3(car.pos.x, car.pos.y, car.pos.z), q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        if track.ticks > 1 {
            let c = track.car(at: liveTime)
            p = SIMD3<Double>(c.pos) + origin
            q = simd_quatd(ix: Double(c.quat.imag.x), iy: Double(c.quat.imag.y), iz: Double(c.quat.imag.z), r: Double(c.quat.real))
        }
        let v = SIMD3(car.vel.x, car.vel.y, car.vel.z)
        let w = world, bodies = car.world.bodies
        // The parked row's roofs count as ground for the lens (0220): on the Show's mark the row is right behind the car.
        camera.update(dt: dt, carPos: p, carQuat: q, vel: v, aspect: Double(aspect)) { x, z in max(w.ground(x, z).y, roofUnder(bodies, x, z) + 0.6) }
        let m = camera.matrices(origin: origin, aspect: aspect)
        view?.update(eye: camera.eye, viewProj: m.proj * m.view)
        return m
    }

    /// Blue hour (AGENTS.md §1): the sun just under the horizon to the south-west, a cold sky with its last warm band, and
    /// air thin enough to see the ranges 30 km off, thick enough to stack them in blue.
    func look(over base: LookU) -> LookU {
        var k = base
        let sun = simd_normalize(SIMD3<Float>(-0.72, -0.05, -0.69))
        k.hemiSky = SIMD4(SIMD3<Float>(0.05, 0.068, 0.12), base.hemiSky.w)
        k.hemiGround = SIMD4(SIMD3<Float>(0.016, 0.018, 0.026), 1)
        k.skyZenith = SIMD4(0.010, 0.018, 0.050, 0); k.skyMid = SIMD4(0.040, 0.062, 0.140, 0); k.skyHorizon = SIMD4(0.26, 0.16, 0.17, 0)
        k.skySun = SIMD4(sun, 0)
        k.hazeCol = SIMD4(0.045, 0.06, 0.105, 1.0 / 9000)
        k.sunCol = SIMD4(0.09, 0.05, 0.045, 1.0 / 1400)
        k.sunDir = SIMD4(sun, base.sunDir.w)
        let nearSlab = origin == .zero && abs(car.pos.x) < 700 && abs(car.pos.z) < 700
        k.fogExp = SIMD4(0, nearSlab ? base.fogExp.y : 0, 1, base.fogExp.w)
        return k
    }

    func drawWorld(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, viewProj: simd_float4x4) {
        guard let v = view else { return }
        // The headlamps, from the car's nose, a little down.
        let q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        let f = q.act(SIMD3(0, -0.08, 1)), u = q.act(SIMD3(0, 1, 0))
        let lp = SIMD3(car.pos.x, car.pos.y, car.pos.z) + q.act(SIMD3(0, 0.15, 2.0)) - origin
        var d = WDriveU(lampPos: SIMD4(SIMD3<Float>(lp), Float(280 * lampK)), lampDir: SIMD4(SIMD3<Float>(simd_normalize(f)), cos(0.42)),
                        params: SIMD4(Float(WorldView.propR), Float(time), Launch.args.contains("-fd-lod") ? 1 : 0, 0))
        _ = u
        v.draw(e, frame: frame, look: &look, drive: &d, shadow: shadow, viewProj: viewProj, eye: camera.eye)
    }

    /// What's under the car (debug, `-fd-stats`).
    var groundLine: String {
        let g = world.ground(car.pos.x, car.pos.z)
        return String(format: "GROUND car (%.1f, %.2f, %.1f) ground %.2f road %.1f m %@ biome %@ low %.1f full %.1f", car.pos.x, car.pos.y, car.pos.z, g.y, g.road, "\(g.surface)", g.land.biome.name, g.land.low, g.land.full)
    }
    /// One line for the debug HUD and the bench.
    var statsLine: String {
        guard let s = view?.stats else { return "" }
        return String(format: "tiles %d · %.0fk tris · roads %d · props %d · %.0f MB · missing %d · %.1f km out · origin (%.0f, %.0f)",
                      s.tiles, Double(s.tris) / 1000, s.roads, s.instances, s.mb, s.missing, dist / 1000, origin.x, origin.z)
    }
}
