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
    let world: FreeWorld
    let camera = DriveCamera()
    private(set) var view: WorldView?
    private(set) var origin = SIMD3<Double>(0, 0, 0)
    /// The car (a Show car: the same machine). In a cruise it's posed, not stepped.
    private(set) var car: Vehicle
    let track = Replay(live: "drive")
    /// A cruise: carried along the roads at this speed (m/s).
    var cruise: Double?
    private var walker: RoadWalker?
    private var time = 0.0
    private(set) var dist = 0.0
    private var lampK = Launch.args.contains("-fd-nolamp") ? 0.0 : 1.0

    init(seed: String = FreeDrive.seedDefault) {
        world = FreeWorld(seed: seed)
        car = createVehicle("show")
        place(x: 0, z: -40, yaw: .pi)
    }

    /// The car at (x, z) on the ground, facing `yaw` (0 = +z), at rest.
    func place(x: Double, z: Double, yaw: Double) {
        let g = world.ground(x, z)
        car.pos.x = x; car.pos.y = g.y + SPEC.comHeight + 0.04; car.pos.z = z
        M3.quatFromYaw(car.quat, yaw)
        car.vel.x = 0; car.vel.y = 0; car.vel.z = 0
        camera.snap()
        rebase(force: true)
    }
    /// Onto the road nearest (x, z), heading away from the centre.
    func placeOnRoad(nearX x: Double, z: Double) {
        let l = max(1e-9, (x * x + z * z).squareRoot())
        guard let w = RoadWalker(world: world, nearX: x, z: z, headingX: x / l, z: z / l) else { return }
        walker = w
        let p = w.pose(lane: 1.8)
        place(x: p.x, z: p.z, yaw: atan2(p.hx, p.hz))
    }

    /// The renderer attached (its device): the world's view is built once.
    func attach(device: MTLDevice) {
        if view == nil { view = WorldView(device: device, world: world) }
        view?.origin = origin   // the drive may have moved its origin before the view existed
    }

    // MARK: - The frame (Game.frame, before the draw)

    func frame(dt: Double) {
        time += dt
        if let v = cruise {
            if walker == nil { walker = RoadWalker(world: world, nearX: car.pos.x, z: car.pos.z, headingX: 0, z: 1) }
            if let w = walker {
                w.advance(v * dt)
                let p = w.pose(lane: 1.8)
                car.pos.x = p.x; car.pos.y = p.y + SPEC.comHeight; car.pos.z = p.z
                M3.quatFromYaw(car.quat, atan2(p.hx, p.hz))
                car.vel.x = p.hx * v; car.vel.y = 0; car.vel.z = p.hz * v
            }
        }
        rebase()
        track.append(car: car, origin: origin)
        track.trim(keep: 8)
        dist = (car.pos.x * car.pos.x + car.pos.z * car.pos.z).squareRoot()
    }
    /// The renderer's clock for the track: its newest tick.
    var liveTime: Double { Double(max(0, track.ticks - 1)) / Replay.hz }

    /// The floating origin: 0 near the centre, else the car's position snapped to a kilometre, moved when it's a kilometre off.
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
        let p = SIMD3(car.pos.x, car.pos.y, car.pos.z), q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        let v = SIMD3(car.vel.x, car.vel.y, car.vel.z)
        let w = world
        camera.update(dt: dt, carPos: p, carQuat: q, vel: v, aspect: Double(aspect)) { x, z in w.ground(x, z).y }
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
