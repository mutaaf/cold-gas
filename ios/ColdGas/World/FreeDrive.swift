// FREE DRIVE on the iPhone (docs/NATIVE-FREEDRIVE.md): the Show's apron at the centre of a world with no edge. Unscored:
// nothing here reaches a score, a log, the board or a medal.
//
// This object owns the drive's world (ColdGasWorld, pure), its view (WorldView), the camera and the floating origin, and
// hands the renderer what it draws through `DriveScene`. The car is the scored Swift car; in a cruise (`-fd-cruise`, the
// bench, the shots) it's carried along the roads at a set speed rather than stepped.
import Foundation
import ColdGasAudio
import Metal
import QuartzCore
import simd
import ColdGasCore
import ColdGasPhysics
import ColdGasWorld
import ColdGasClient

/// What the renderer asks of a drive (Renderer.drive): the lens, the origin, the look, and the world's draw.
protocol DriveScene: AnyObject {
    /// World metres the frame is drawn relative to (0 near the centre, so the stage's own lights and glints stay put).
    var origin: SIMD3<Double> { get }
    /// The view and lens this frame (render space), after the world has chosen its tiles for it.
    func frameCamera(aspect: Float, dt: Double) -> (view: simd_float4x4, proj: simd_float4x4, eye: SIMD3<Float>)
    /// The drive's sky and air over the stage's.
    func look(over base: LookU) -> LookU
    /// The world, in the main pass, after the stage's opaque draws (`sky`: the physical sky's view LUT, 0231/0310; `quality`
    /// 2 … 0 by the renderer's shed: the grass).
    func drawWorld(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, sky: MTLTexture, viewProj: simd_float4x4, quality: Int)
    /// The world's blended layers (water, spray), after the sky (0310, §9.4).
    func drawWorldLate(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, sky: MTLTexture, viewProj: simd_float4x4)
    /// The world's compute before the frame's passes (0310): surfaces baked, props culled, the world's shadow when due.
    func encodeWorld(_ cmd: MTLCommandBuffer, ring: Int, keyDir: SIMD3<Float>)
    /// The key light (0231): the sun (or the moon) as the time of day has it, and the exposure; nil keeps the stage's.
    var key: DriveKey? { get }
    /// The world's cached shadow (0310): the map, its view-projection, whether it's drawn.
    var worldShadow: (map: MTLTexture, vp: simd_float4x4, on: Bool)? { get }
    /// The world's heaps, resident on the renderer's queue while the drive is drawn (0310).
    var residency: MTLResidencySet? { get }
    /// The tyres on the ground and the loose things, once a frame before the effects update (0223).
    func effects(_ crash: Crash, dt: Double)
    /// An impact felt in the lens.
    func shake(_ a: Float)
    /// Bumped each time the car is made whole.
    var repairs: Int { get }
    /// The drive's car as the renderer shows it (0225): each brake disc's glow, the pedal for the brake lamps.
    var carLook: DriveCarLook { get }
    /// 0333: the car's damage as the drive's physics has it (the renderer draws the same), nil to let the crash keep its own.
    var carDamage: CarDamage? { get }
}
/// The drive's key light: toward the light (unit), its colour (peak 1) × intensity, and the frame's exposure.
struct DriveKey { var dir: SIMD3<Float>; var color: SIMD3<Float>; var intensity: Float; var exposure: Float }
extension DriveScene { var carDamage: CarDamage? { nil } }
/// What a drive tells the renderer about its car beyond the track.
struct DriveCarLook {
    /// Each disc's glow (0 dark … ≈ 1 orange-hot), from its temperature.
    var glow = SIMD4<Float>(repeating: 0)
    /// The brake pedal (0…1); the brake lamps follow it.
    var pedal: Float = 0
    /// 0332: the coat (CarDirt): sills, nose, tail, wheels; its colour (rgb) and the body's coat (w); packed snow. `wet`: how wet the
    /// car is (0…1, WATER's 0320 Wading.wet, or a ford's) and `wetLine` how high the water reached on it (0 sills … 1 roof),
    /// drying. `coated`: anything to draw.
    var dirt = SIMD4<Float>(repeating: 0), coat = SIMD4<Float>(0.3, 0.23, 0.16, 0), snow: Float = 0, wet: Float = 0, wetLine: Float = 0
    var coated: Bool { dirt.max() > 0.01 || coat.w > 0.01 || snow > 0.01 || wet > 0.01 }
    /// 0333: each wheel's toe and camber from a bent arm (rad).
    var toe = SIMD4<Float>(repeating: 0), camber = SIMD4<Float>(repeating: 0)
}

final class FreeDrive: DriveScene {
    static let seedDefault = "cold gas"
    /// Stability control in Free Drive and Roam (0269; Settings → Driving): on, sport or off, kept on this device.
    static var stability: DriveModel.ESC = DriveModel.ESC(rawValue: UserDefaults.standard.integer(forKey: "coldgas.stability")) ?? .on {
        didSet { UserDefaults.standard.set(stability.rawValue, forKey: "coldgas.stability") }
    }
    /// The brakes and the assists (0281; Settings → Driving), kept on this device: ABS, traction control (off: the motors'
    /// coupling only, whatever stability control is set to), the drift assist, the brake balance's front share.
    static var absOn: Bool = UserDefaults.standard.object(forKey: "coldgas.abs") as? Bool ?? true {
        didSet { UserDefaults.standard.set(absOn, forKey: "coldgas.abs") }
    }
    static var traction: Bool = UserDefaults.standard.object(forKey: "coldgas.traction") as? Bool ?? true {
        didSet { UserDefaults.standard.set(traction, forKey: "coldgas.traction") }
    }
    static var driftAssist: Bool = UserDefaults.standard.object(forKey: "coldgas.driftAssist") as? Bool ?? true {
        didSet { UserDefaults.standard.set(driftAssist, forKey: "coldgas.driftAssist") }
    }
    // 0301: a stored balance outside 0.3…0.8 (or not a number) would brake the rear backwards; it reads as the road's.
    static var brakeBias: Double = Guard.number(UserDefaults.standard.object(forKey: "coldgas.brakeBias") as? Double, in: 0.3...0.8, fallback: DriveSpec.brakeBias).value {
        didSet { UserDefaults.standard.set(brakeBias, forKey: "coldgas.brakeBias") }
    }
    /// The handbrake held on the glass (the deck's HAND; Game sets it each frame).
    var handbrake = false
    #if DEBUG
    /// `-fd-drill stop|lock|handbrake|drift` (0281): a scripted manoeuvre on a loop once the world is built, for shots and a
    /// look at the chassis without a thumb: a stop from 100 km/h (lock: with ABS off), a handbrake turn, a held drift.
    static let drill = Launch.value("-fd-drill")
    private var drillT = 0.0
    /// `-fd-hold throttle,steer[,after s[,brake]]`.
    static let hold: (Double, Double, Double, Double)? = {
        guard let a = Launch.value("-fd-hold")?.split(separator: ",").compactMap({ Double($0) }), a.count >= 2 else { return nil }
        return (a[0], a[1], a.count > 2 ? a[2] : 0, a.count > 3 ? a[3] : 0)
    }()
    #endif
    let world: FreeWorld
    let camera = DriveCamera()
    /// The time of day (#365's DriveSky, 0310): the sun, the sky, the key light; the sun button cycles it.
    let sky = DriveSky()
    private(set) var view: WorldView?
    private(set) var origin = SIMD3<Double>(0, 0, 0)
    /// The car: the scored machine on DRIVE_COURSE (the Show's stage at the centre) or a roam's course (0220: the Wall's
    /// or the Lineup's set there instead), its world streamed round it.
    private(set) var car: Vehicle
    /// The course the drive stands on ("drive", "drive-wall", "drive-lineup") and the scored course whose set that is.
    let course: Course
    var stage: String { stageOf(course.id) }
    let streamer: DriveStreamer
    /// The water (0320, Water.swift): the sea, the lakes and the rivers (FreeWorld.water, 0310), their waves, maps, levels and
    /// currents; `water` draws them as a world layer once a renderer is attached.
    let sea: Sea
    private(set) var water: WaterView?
    /// The drive's own chassis (0225, DriveCar.swift): soft springs, combined-slip tyres, the rear motors' vectoring, ABS,
    /// hot brakes. `-fd-classic` (Debug) drives the scored car's model instead, for comparison.
    let chassis = DriveModel()
    let ownCar = !Launch.args.contains("-fd-classic")
    let track: Replay
    /// The controls (Controls routes the touches here while the drive is up): src/input.js sample, the Standard hands.
    let sampler = InputSampler(level: .standard)
    /// 0301: a non-finite input has been let go this drive (said once, not every tick).
    private var inputRepaired = false
    private let input = Input()
    /// A cruise (the shots): carried along the roads at this speed (m/s), not stepped.
    var cruise: Double?
    /// The autopilot (the bench): a road-following driver at this speed (m/s), as src/drive/pilot.js.
    var pilot: Double?
    /// The suction fan, armed or not (the web's X).
    var fan = false
    /// The brake pedal this tick (the brake lamps follow the pedal, not a guess from the car's deceleration).
    private(set) var pedal = 0.0
    private var walker: RoadWalker?
    private var holdT = 0.0
    private var time = 0.0, acc = 0.0, airT = 0.0, flipT = 0.0, stuckT = 0.0, reverseHeld = 0.0
    private(set) var dist = 0.0, resets = 0
    private var lampK = Launch.args.contains("-fd-nolamp") ? 0.0 : 1.0
    /// A reset's cue for the HUD ("Back on the road"), and when it was given.
    private(set) var cue = "", cueT = -10.0
    /// The safety nets (0229): wedged against something with a pedal pressed, sunk into something solid, or a state that
    /// isn't a number: back on the road. The last pose that was a number, for a reset that can't trust the car's.
    private var wedge = WedgeWatch(warnAfter: 1.0, actAfter: 1.5), sunkT = 0.0
    private var lastGood = (x: 0.0, z: 0.0, hx: 0.0, hz: 1.0)

    /// `onMark`: on the scored course's own mark, facing down its run (Roam, 0220); otherwise Free Drive's start on the
    /// apron, facing out.
    init(seed: String = FreeDrive.seedDefault, course: Course = DRIVE_COURSE, onMark: Bool = false) {
        world = FreeWorld(seed: seed)
        streamer = DriveStreamer(world: world)
        let s = Sea(world: world)
        sea = s
        self.course = course
        track = Replay(live: course.id)
        car = createVehicle(course: course)
        car.world.streamer = streamer
        // The chassis puts its downforce at the axles; the streamer's (through the centre) is for the scored model.
        streamer.aero = !ownCar
        // The set's loose things and its dressing (0273: tyre stacks, drums, cases, barrier, the generator), at their masses.
        looseSpots = looseSet(stageOf(course.id)) + dressingSet(stageOf(course.id))
        for s in looseSpots { addLoose(car.world, s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw) }
        looseSpeed = Array(repeating: 0, count: looseSpots.count)
        chassis.stability(FreeDrive.stability)
        chassis.water.level = { [unowned s] x, z in s.level(x, z) }
        chassis.water.current = { [unowned s] x, z in s.current(x, z) }   // a river's (0310's flow)
        // MATTER's wetness (the coat rinsed, mud from soaked ground, the paint dark and glossy) is WATER's (0330 + 0320).
        let wd = chassis.water
        wetSource = { [unowned wd] in wd.wet }
        // A roam's small challenges (0274), kept on this device per set.
        if onMark {
            let st = stageOf(course.id)
            challenges = SetChallenges(stage: st, saved: FreeDrive.savedChallenges(st))
            tyreIdx = looseSpots.indices.filter { looseSpots[$0].kind == .tyre }
            laneIdx = st == "lineup" ? looseSpots.indices.filter { let s = looseSpots[$0]; return s.kind == .cone && abs(abs(s.x) - 3.6) < 0.01 && s.z <= -4 && s.z >= -64 } : []
        }
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
        chassis.settle()
        chassis.water.tow(); water?.fx.breakWake()
        sampler.freshRun()
        airT = 0; flipT = 0; stuckT = 0; reverseHeld = 0
        camera.snap()
        rebase(force: true)
        walker = nil
    }
    /// Onto the road nearest (x, z) (in the right-hand lane), heading `away` from the centre or along (hx, hz).
    @discardableResult
    func placeOnRoad(nearX x: Double, z: Double, heading: (Double, Double)? = nil) -> Bool {
        guard x.isFinite, z.isFinite else { return false }
        let l = max(1e-9, (x * x + z * z).squareRoot())
        var h = heading ?? (x / l, z / l)
        if !(h.0.isFinite && h.1.isFinite) || h.0 * h.0 + h.1 * h.1 < 1e-12 { h = (x / l, z / l) }
        guard let w = RoadWalker(world: world, nearX: x, z: z, headingX: h.0, z: h.1) else { return false }
        let p = w.pose(lane: 1.8)
        place(x: p.x, z: p.z, yaw: atan2(p.hx, p.hz))
        walker = w
        return true
    }
    /// Back on the nearest road, facing the way the car was going (src/drive/index.js respawn).
    func reset() {
        // A car that isn't a number (0229) is put back from the last pose that was.
        let sane = carFinite(car)
        if !sane { for v in [car.vel, car.angVel, car.angMom] { v.x = 0; v.y = 0; v.z = 0 } }
        let f = forward
        let moving = sane && abs(car.vel.x) + abs(car.vel.z) > 2
        let x = sane ? car.pos.x : lastGood.x, z = sane ? car.pos.z : lastGood.z
        if !placeOnRoad(nearX: x, z: z, heading: moving ? (car.vel.x, car.vel.z) : sane ? (f.0, f.1) : (lastGood.hx, lastGood.hz)) {
            // No road near (or none found): back on the set's own mark.
            place(x: course.startX, z: course.startZ, yaw: course.id == "drive-lineup" ? 0 : .pi)
        }
        wedge.reset(); sunkT = 0
        damage.reset(); chassis.toe = damage.toe; chassis.powerK = 1
        for i in 0..<4 { strokeAt[i] = nil; rolledAt[i] = nil }
        resets += 1
        repairs += 1
        say("Back on the road")
    }
    private func say(_ s: String) { cue = s; cueT = time }
    /// The sun button (0231, 0310): the next time of day, named on the screen.
    func cycleSky() { sky.cycle(); say(sky.preset.label) }
    /// The game's line for a moment (a challenge done), shown as the drive's own cues are.
    func announce(_ s: String) { say(s) }
    private var forward: (Double, Double) {
        let q = car.quat
        return (2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    }

    /// The set's loose things (0223): where each was put, for a fresh start.
    private(set) var looseSpots: [LooseSpot] = []
    private var looseSpeed: [Double] = []
    /// How many times the car's been made whole (the renderer repairs its damage when this changes).
    private(set) var repairs = 0
    private var smokeAcc = [Double](repeating: 0, count: 4), dustAcc = [Double](repeating: 0, count: 4)
    /// What each wheel last found underfoot (0310's FreeWorld.sample: the surface, how wet the ground is, the lying snow).
    private var groundAt: [(x: Double, z: Double, y: Double, s: Surface, wet: Double, snow: Double)] = Array(repeating: (.nan, .nan, 0, .grass, 0, 0), count: 4)
    /// The tyres' work this frame, for the haptics (0…1): sliding, and rough ground.
    private(set) var slideK = 0.0, roughK = 0.0
    private var fxSeed: UInt32 = 0x9e3779b9
    /// MATTER (0330–0333, docs/NATIVE-MATTER.md): what the car carries away from the ground and what the hits did to it.
    /// Damage stays for the drive and a reset restores it; the coat stays through a reset (it washes off in water).
    var damage = CarDamage()
    var dirt = CarDirt()
    /// The ground's memory on the GPU (ruts, berms, laid grass); nil without read-write textures.
    private(set) var trace: TraceField?
    /// The trace as a layer of the world (0310 §9.4).
    private var matterLayer: MatterLayer?
    /// `-fd-wet` taken (Debug).
    var wetDebug = false
    /// How wet the car is (0…1): WATER's (0320: Wading.wet, set in init), and a ford's own (a wheel in water soaks it, it drains).
    var wetSource: (() -> Double)?
    var fordWet = 0.0
    /// Each wheel's last stroke on soft ground (world xz), its matter and when it rolled there (for the dirt's metres).
    var strokeAt = [SIMD2<Double>?](repeating: nil, count: 4)
    var rolledAt = [SIMD2<Double>?](repeating: nil, count: 4)
    var impSeen = 0, matterSeed: UInt32 = 0x2545f491
    var clodAcc = [Double](repeating: 0, count: 4)
    /// 0334: trees felled this drive, and where each snapped (its splinters thrown on the next frame).
    var felled = 0, wreckT = 0.0
    /// The tyres' effects' cost on the main thread (µs, smoothed): the stats line and the PR's measurements.
    var effectsUs = 0.0
    var splinters: [SIMD3<Double>] = []
    /// `-matter-off` (shots: the before): no traces, coat, damage model or new roost; the drive as it was.
    static let matterOn = !Launch.args.contains("-matter-off")
    private var noted = false

    /// The renderer attached (its device): the world's view is built once.
    func attach(device: MTLDevice) {
        if view == nil {
            view = WorldView(device: device, world: world)
            if view == nil { Report.error(.world, .error, "the drive's world view couldn't be built") }   // 0293
            if FreeDrive.matterOn, let t = TraceField(device: device) { trace = t; matterLayer = MatterLayer(trace: t) }
        }
        if water == nil {
            water = WaterView(device: device, sea: sea)
            if water == nil { Report.error(.world, .error, "the drive's water couldn't be built") }
        }
        // The water is a layer of the world (0310, §9.4): it owns the sea, bakes its waves in the world's compute and draws
        // after the sky.
        if let v = view, let wv = water { v.add(wv) }
        // MATTER's ground memory is a layer too (0330): strokes in the world's compute, its atlas bound for matter_ground.
        if let v = view, let ml = matterLayer { v.add(ml) }
        view?.origin = origin   // the drive may have moved its origin before the view existed
    }

    // MARK: - The frame (Game.frame, before the draw)

    func frame(dt: Double) {
        time += dt
        sky.advance(dt)
        if let v = cruise { cruiseFrame(v, dt) }
        else {
            acc += min(dt, 0.1)
            do {
                while acc >= DT {
                    let air = car.grounded == 0 && !car.hullContact && !chassis.water.floating
                    airT = air ? airT + DT : 0
                    let phase: Phase = airT > 0.25 ? .air : .drive
                    sampler.sample(phase, .assist, input, false, car)
                    if let v = pilot { drivePilot(v, input) }
                    #if DEBUG
                    // `-fd-hold throttle,steer[,after s]`: a held throttle and steer, `after` seconds once the world near the car is built
                    // (shots: a run into the row, a slide).
                    if let h = FreeDrive.hold, view?.settled == true, (view?.stats.tiles ?? 0) > 0 {
                        holdT += DT
                        if holdT >= h.2 { input.throttle = h.0; input.steer = h.1; input.brake = h.3 }
                    }
                    if let d = FreeDrive.drill, view?.settled == true, (view?.stats.tiles ?? 0) > 0 { drill(d, input) }
                    #endif
                    input.fan = fan ? 1 : 0
                    if phase == .drive { reverse(input) }
                    // The player's stability setting, and on touch (a slider or a tilt) a light countersteer (0269).
                    if chassis.esc != FreeDrive.stability { chassis.stability(FreeDrive.stability) }
                    chassis.counterAssist = pilot == nil && (sampler.touch.active || sampler.tilt != 0) ? DriveSpec.counterAssistTouch : 0
                    // 0281: the brakes and the assists as set, and the lever (on the ground only: in the air it does nothing).
                    chassis.abs = FreeDrive.absOn; chassis.brakeBias = FreeDrive.brakeBias
                    chassis.driftAssist = FreeDrive.driftAssist && pilot == nil
                    if !FreeDrive.traction { chassis.tc = .off }
                    else if chassis.tc == .off && chassis.esc != .off { chassis.tc = chassis.esc == .on ? .on : .sport }
                    #if DEBUG
                    if FreeDrive.drill == nil { car.handbrake = handbrake && phase == .drive && pilot == nil ? 1 : 0 }
                    #else
                    car.handbrake = handbrake && phase == .drive && pilot == nil ? 1 : 0
                    #endif
                    #if DEBUG
                    if Inject.nanTick() { input.steer = .nan; input.throttle = .infinity }   // 0301: `-nan-input`
                    #endif
                    // 0301: a control that isn't a number (a sensor's NaN, a pad's garbage) is let go before the engine sees it.
                    if guardInput(input) > 0 && !inputRepaired { inputRepaired = true; Report.error(.drive, .error, "drive input not finite: let go") }
                    // The sea's clock, and the loose things in it (0320).
                    sea.time += DT
                    if sea.wet && !car.world.loose.isEmpty { floatLoose(car.world, level: { sea.level($0, $1) }) }
                    if FreeDrive.matterOn { chassis.toe = damage.toe; chassis.powerK = damage.powerK }
                    if ownCar { try driveStep(car, input, chassis) } else { try step(car, input) }
                    if FreeDrive.matterOn { absorbImpacts() }
                    // A state that isn't a number never reaches the engine again (0229): back on the road at once.
                    if !carFinite(car) { print("DRIVE car state not finite: reset"); Report.error(.drive, .trap, "drive car state not finite"); Report.recovered(.world, ok: true); reset(); acc = 0; break }
                    pedal = input.brake
                    streamer.breakCheck(car.world, car: car)
                    readLoose(car.world)
                    // Unscored, so the tanks top up on the ground (a full charge in 8 s): the jets always work on a roam.
                    if car.grounded > 0 { car.air = min(CAR.airMass, car.air + CAR.airMass * DT / 8) }
                    track.append(car: car, origin: origin)
                    // The impact buffer is the scored run's fixed one (the first 768 are a run's crash): a drive never ends,
                    // so it's emptied before it fills, or the crashes would stop being felt and seen (0229).
                    if car.impacts.count >= car.impacts.cap - 64 { car.impacts.count = 0; track.rewindImpacts(); impSeen = 0 }
                    acc -= DT
                    rebase()
                }
            } catch { print("DRIVE sim stopped: \(error)"); Report.error(.drive, .trap, "drive sim stopped: \(error)"); Report.recovered(.world, ok: true); reset() }
            watchdog(dt)
            #if DEBUG
            matterDebug(dt)
            #endif
            if carFinite(car) {
                let f = forward
                lastGood = (car.pos.x, car.pos.z, f.0, f.1)
            }
            looseHits()
            roadside()
            challengeFrame(dt)
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

    #if DEBUG
    /// One tick of `-fd-drill` (see `drill`): up to speed on the road ahead, the manoeuvre, a coast, again.
    private func drill(_ d: String, _ i: Input) {
        drillT += DT
        let f = forward, vf = car.vel.x * f.0 + car.vel.z * f.1
        i.brake = 0; i.steer = 0; i.throttle = 0; car.handbrake = 0
        switch d {
        case "stop", "lock":
            // To 100 km/h, then the pedal flat to a stop, 2 s still, again. `lock` stops with ABS off (and wears a flat spot).
            if d == "lock" { chassis.abs = false }
            if drillT < 30 && vf < 27.8 && drillT >= 0 { i.throttle = 0.5 }
            else if drillT >= 0 { drillT = -1000; print(String(format: "DRILL brake from %.1f m/s at (%.1f, %.1f)", vf, car.pos.x, car.pos.z)) }
            if drillT < -500 {
                i.brake = 1
                if abs(vf) < 0.3 { print(String(format: "DRILL stopped at (%.1f, %.1f) ABS %@", car.pos.x, car.pos.z, chassis.abs ? "on" : "off")); drillT = -3 }
            }
        default:
            // "handbrake" / "drift": to 15 m/s, into a bend, the lever for 0.25 s, then the thumb held (a little into the
            // turn, 22 % throttle: the drift assist holds it) for 2 s (handbrake) or 6 s (drift), a coast, again.
            let hold = d == "drift" ? 6.0 : 2.0
            if drillT < 20 && vf < 15 && drillT >= 0 { i.throttle = 0.4 }
            else if drillT >= 0 { drillT = -100 }
            if drillT < -50 {
                let t = drillT + 100
                i.steer = t < 0.5 ? 0.5 : 0.25
                car.handbrake = t > 0.15 && t < 0.4 ? 1 : 0
                i.throttle = t > 0.4 ? 0.22 : 0
                if t > 0.4 + hold { drillT = -4 }
            }
        }
    }
    #endif
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
        // Lane keeping (0224): how far the car sits right of its lane's centre, abreast of it (+ = right of the lane).
        let here = w.pose(lane: 1.8)
        let laneErr = (car.pos.x - here.x) * -here.hz + (car.pos.z - here.z) * here.hx
        let look = 7 + speed * 0.45
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
        // Pure pursuit for the bend, plus a Stanley term that pulls the car back onto its lane line (it used to cut
        // bends across the centre line).
        let hold = -atan(1.4 * laneErr / max(speed, 6))
        i.steer = max(-1, min(1, (ang + hold) * 2.2))   // + = right (src/drive/pilot.js)
        i.throttle = speed < want ? min(1, (want - speed) * 0.35 + 0.15) : 0
        i.brake = speed > want + 2 ? min(1, (speed - want) * 0.15) : 0
    }

    /// Upside down, fallen, in the sea or stuck: back on the road (src/drive/index.js watchdog).
    private func watchdog(_ dt: Double) {
        if !carFinite(car) { reset(); return }
        let q = car.quat, upY = 1 - 2 * (q.x * q.x + q.z * q.z)
        let speed = (car.vel.x * car.vel.x + car.vel.y * car.vel.y + car.vel.z * car.vel.z).squareRoot()
        flipT = upY < 0.25 && speed < 4 && (car.grounded > 0 || car.hullContact) ? flipT + dt : 0
        if flipT > 2 { reset(); return }
        let g = world.ground(car.pos.x, car.pos.z)
        if car.pos.y < g.y - 30 { reset(); return }
        // In the sea (0320): drowned, or adrift going nowhere, the car is towed out (a car afloat is left to float).
        if waterWatch(dt) { reset(); announce("Towed out of the water"); return }
        let jets = car.throttles[0] + car.throttles[1] + car.throttles[2] + car.throttles[3]
        let afloat = chassis.water.floating || chassis.water.submerged > 0.05
        stuckT = speed < 0.6 && car.grounded == 0 && jets < 0.4 && !afloat ? stuckT + dt : 0
        if stuckT > 3 { reset(); return }
        // Wedged (0229): against a trunk, a post or a wall, still, with a pedal pressed and going nowhere for 1.5 s (a
        // car resting against something with the pedals up is left alone; reversing out moves it, which clears this).
        let pressing = abs(input.throttle) > 0.2
        if wedge.step(car, dt: dt, eligible: pressing && cruise == nil && pilot == nil) == .act { reset(); return }
        // Sunk into something solid (the hull ≥ 30 cm inside it) for a second: the engine isn't pushing it out.
        sunkT = deepestPenetration(car.world) < -0.3 ? sunkT + dt : 0
        if sunkT > 1 { reset() }
    }

    /// A loose thing struck (its speed jumping): a knock in the sound and the hands, scaled by the impulse it took (0269:
    /// its mass × its change of speed, so a 4 kg cone flicked away is a tick and a water-filled barrier shoved is a thud).
    private func looseHits() {
        for (i, b) in car.world.loose.enumerated() where i < looseSpeed.count {
            let v = b.speed, was = looseSpeed[i]
            looseSpeed[i] = v
            if let k = LooseKind.knock(b.kind, dv: v - was) {
                Sound.shared.hit(FreeDrive.hitMaterial(b.kind), k: k, at: SIMD3<Float>(Float(b.x - origin.x), Float(b.y - origin.y), Float(b.z - origin.z)), seed: i &* 7919 &+ Int(v * 100))
                HapticPlayer.shared.play(HapticEvent(kind: .hit, tick: 0, channel: 4, intensity: Float(0.25 + 0.6 * k), sharpness: b.kind == .cone || b.kind == .drum ? 0.85 : b.kind == .tyre ? 0.3 : 0.5))
            }
        }
    }
    // MARK: - Roam's challenges (0274)

    /// The set's challenges (a roam only; nil in Free Drive).
    private(set) var challenges: SetChallenges?
    private var tyreIdx: [Int] = [], laneIdx: [Int] = []
    /// How long each tyre has been off its stack: one counts once it's stayed off half a second (a tyre read mid-wobble, or
    /// in the world's first frames, isn't down).
    private var tyreDownT: [Double] = []
    /// What's happened since the game last asked (it says it, buzzes and saves).
    private var challengeEvents: [SetChallengeEvent] = []
    func drainChallenges() -> [SetChallengeEvent] { defer { challengeEvents.removeAll(keepingCapacity: true) }; return challengeEvents }
    private func challengeFrame(_ dt: Double) {
        guard let ch = challenges, cruise == nil, pilot == nil else { return }
        let loose = car.world.loose
        var down = 0
        if tyreDownT.count != tyreIdx.count { tyreDownT = Array(repeating: 0, count: tyreIdx.count) }
        for (j, i) in tyreIdx.enumerated() where i < loose.count {
            let b = loose[i], s = looseSpots[i]
            let up = 1 - 2 * (b.qx * b.qx + b.qz * b.qz)
            let moved = ((b.x - s.x) * (b.x - s.x) + (b.z - s.z) * (b.z - s.z)).squareRoot()
            let off = b.y < s.y + b.kind.half.1 - 0.08 || moved > 1.0 || up < 0.7
            tyreDownT[j] = off ? tyreDownT[j] + dt : 0
            if off && tyreDownT[j] >= 0.5 {
                down += 1
                #if DEBUG
                if Launch.args.contains("-roam-log") && Int(time * 2) != Int((time - dt) * 2) { FreeDrive.roamLog(String(format: "ROAM %.2f tyre %d down: y %.3f (stood %.3f) moved %.2f up %.2f asleep %d car (%.1f, %.1f)", time, i, b.y, s.y + b.kind.half.1, moved, up, b.asleep ? 1 : 0, car.pos.x, car.pos.z)) }
                #endif
            }
        }
        let conesMoved = laneIdx.contains { $0 < loose.count && loose[$0].speed > 0.05 }
        let speed = (car.vel.x * car.vel.x + car.vel.y * car.vel.y + car.vel.z * car.vel.z).squareRoot()
        let airborne = car.grounded == 0 && !car.hullContact
        let ev = ch.update(dt: dt, x: car.pos.x, y: car.pos.y, z: car.pos.z, speed: speed, airborne: airborne, tyresDown: down, conesMoved: conesMoved)
        if !ev.isEmpty {
            #if DEBUG
            if Launch.args.contains("-roam-log") { FreeDrive.roamLog(String(format: "ROAM at %.2f s: %@ · car (%.1f, %.2f, %.1f) %.1f m/s air %d", time, "\(ev)", car.pos.x, car.pos.y, car.pos.z, speed, airborne ? 1 : 0)) }
            #endif
            challengeEvents += ev
            FreeDrive.saveChallenges(ch)
        }
    }
    #if DEBUG
    /// `-roam-log`: the challenges' moments into Caches/roam.log (a shot's launch has no console).
    static func roamLog(_ s: String) {
        print(s)
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("roam.log")
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write((s + "\n").data(using: .utf8)!); try? h.close() }
        else { try? (s + "\n").write(to: url, atomically: true, encoding: .utf8) }
    }
    #endif
    private static func key(_ stage: String) -> String { "coldgas.roam.challenges.\(stage)" }
    static func savedChallenges(_ stage: String) -> [SetChallengeKind: SetChallengeState] {
        // 0301: entry by entry, so one bad field costs that challenge, not the set's others; a best that isn't a number goes.
        guard let d = UserDefaults.standard.data(forKey: key(stage)), let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        var out: [SetChallengeKind: SetChallengeState] = [:]
        for (k, v) in m {
            guard let kk = SetChallengeKind(rawValue: k), JSONSerialization.isValidJSONObject([v]),
                  let e = try? JSONSerialization.data(withJSONObject: v, options: .fragmentsAllowed),
                  var s = try? JSONDecoder().decode(SetChallengeState.self, from: e) else { continue }
            if let b = s.best, !b.isFinite { s.best = nil }
            out[kk] = s
        }
        return out
    }
    static func saveChallenges(_ ch: SetChallenges) {
        var m: [String: SetChallengeState] = [:]
        for (k, v) in ch.states { var s = v; if let b = s.best, !b.isFinite { s.best = nil }; m[k.rawValue] = s }   // 0301: JSONEncoder throws on NaN
        if let d = try? JSONEncoder().encode(m) { UserDefaults.standard.set(d, forKey: key(ch.stage)) }
    }

    /// What a loose thing sounds like struck: plastic, timber, steel (a drum rings like a rail), concrete, rubber's dull thump.
    static func hitMaterial(_ k: LooseKind) -> HitMaterial {
        switch k {
        case .cone, .barrier: return .plastic
        case .fence, .roadCase, .log: return .wood
        case .rail, .drum: return .rail
        case .sign, .signpost: return .sign
        case .kRail: return .stone
        case .tyre: return .earth
        case .generator: return .body
        }
    }
    /// The roadside's breaks and restorations (0227): the drawn instance hidden or shown, and a break felt and heard by
    /// what it was (timber cracks, steel bangs), scaled by the car's speed into it.
    private func roadside() {
        for c in streamer.drainChanges() {
            // 0334: a felled tree's instance is found by where it stood (trees aren't roadside items).
            if c.kind == .trunk { view?.setFelled(x: c.x, z: c.z, c.broken) } else { view?.setBroken(cx: c.cx, cz: c.cz, item: c.item, c.broken) }
            #if DEBUG
            if Launch.args.contains("-fd-stats") { print(String(format: "ROADSIDE %@ %@ at (%.1f, %.1f) %.1f m/s", c.broken ? "broke" : "stands", "\(c.kind)", c.x, c.z, c.speed)) }
            #endif
            guard c.broken else { continue }
            let k = Float(min(1, c.speed / 25))
            let steel = c.kind == .rail || c.kind == .sign
            if c.kind == .trunk {
                // A trunk snapping: a crack you feel, splinters and bark, a shake; the crown comes down after it.
                Sound.shared.hit(.wood, k: 1, at: SIMD3<Float>(Float(c.x - origin.x), Float(c.y - origin.y + 0.6), Float(c.z - origin.z)), seed: c.item &* 17 &+ c.cz)
                HapticPlayer.shared.play(HapticEvent(kind: .crush, tick: 0, channel: 4, intensity: 1, sharpness: 0.6))
                camera.shake(0.9)
                felled += 1; Signs.event("tree-felled")
                splinters.append(SIMD3(c.x, c.y + 0.6, c.z))
                continue
            }
            Sound.shared.hit(c.kind == .rail ? .rail : c.kind == .sign ? .sign : .wood, k: Double(k), at: SIMD3<Float>(Float(c.x - origin.x), Float(c.y - origin.y), Float(c.z - origin.z)), seed: c.item &* 31 &+ c.cx)
            HapticPlayer.shared.play(HapticEvent(kind: .hit, tick: 0, channel: 4, intensity: 0.4 + 0.6 * k, sharpness: steel ? 0.8 : 0.55))
            camera.shake(0.25 + 0.5 * k)
        }
    }
    /// The set's loose things back where they stood.
    func resetSet() {
        let spots = looseSpots, loose = car.world.loose
        // (the roadside's broken pieces past the set's own stay where they lie: theirs is the streamer's to restore)
        resetLoose(car.world) { i in if i < spots.count { let s = spots[i]; return (s.x, s.y, s.z, s.yaw) }; let b = loose[i]; return (b.x, b.y - b.kind.half.1, b.z, 2 * atan2(b.qy, b.qw)) }
        for i in looseSpeed.indices { looseSpeed[i] = 0 }
        view?.marks?.clear()
    }

    private func rnd() -> Float { fxSeed ^= fxSeed << 13; fxSeed ^= fxSeed >> 17; fxSeed ^= fxSeed << 5; return Float(fxSeed) / Float(UInt32.max) }
    /// Once a frame (the renderer, before its effects update): what the tyres do to the ground (0223). Rubber laid down
    /// by a slide or a spin, smoke off a hard one on paving, dust and grit thrown up off the loose ground, spray from water.
    func effects(_ crash: Crash, dt: Double) {
        guard cruise == nil, dt > 0 else { return }
        let fxT0 = CACurrentMediaTime()
        defer { effectsUs += ((CACurrentMediaTime() - fxT0) * 1e6 - effectsUs) * 0.05 }   // the stats line: the tyres' work on the main thread
        let q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        let p = SIMD3(car.pos.x, car.pos.y, car.pos.z), v = SIMD3(car.vel.x, car.vel.y, car.vel.z)
        let right = q.act(SIMD3(1, 0, 0)), fwd = q.act(SIMD3(0, 0, 1))
        let speed = simd_length(v)
        var slide = 0.0, rough = 0.0
        for (i, w) in car.wheels.enumerated() {
            let a = WHEELS[i], anchor = p + q.act(SIMD3(a.x, a.y, a.z))
            guard w.contact, w.ny > 0.85 else { view?.marks?.mark(i, at: anchor, side: right, width: 0.25, strength: 0, origin: origin); strokeAt[i] = nil; rolledAt[i] = nil; continue }
            // What's underfoot, asked again only once the wheel has moved half a metre.
            var g = groundAt[i]
            if !(abs(g.x - anchor.x) < 0.5 && abs(g.z - anchor.z) < 0.5) {
                // (0330 on 0310: the land's own sample, so grip, ruts and roost read the wetness and snow the land is drawn with)
                let gp = world.sample(anchor.x, anchor.z)
                let floor = gp.floor || (abs(anchor.x) < ColdGasWorld.Site.half && abs(anchor.z) < ColdGasWorld.Site.half)
                g = (anchor.x, anchor.z, floor ? 0 : gp.y, floor ? .concrete : gp.surface, floor ? 0 : gp.wetness, floor ? 0 : gp.snow)
                groundAt[i] = g
            }
            // On a roof, a deck or a ramp the ground below isn't what it's touching: no mark there.
            if anchor.y - g.y > 1.0 { view?.marks?.mark(i, at: anchor, side: right, width: 0.25, strength: 0, origin: origin); strokeAt[i] = nil; rolledAt[i] = nil; continue }
            let ground = SIMD3(anchor.x, g.y, anchor.z)
            let longS = max(0, (abs(w.slip) - 0.08) / 0.2), latS = max(0, (abs(w.slipAngle) - 0.05) / 0.12)
            let s = min(1, max(longS, latS)) * (speed > 1.2 || abs(w.omega) > 6 ? 1 : 0)
            slide = max(slide, s)
            // The ground's wetness is the land's (a shore, a river bank: mud), not the car's; `-fd-wet` stands in for rain.
            let wetNow = max(g.wet, wetDebug ? wetness : 0)
            let freezing = g.y > GroundMatter.snowLine || g.snow > 0.5
            let matter = GroundMatter.of(g.snow > 0.5 && g.s == .grass ? .snow : g.s, wet: wetNow, freezing: freezing)
            if FreeDrive.matterOn {
                // The tyre's grip over what the engine's cell gives (its dry matter): a wet road, soaked ground gone to mud.
                let dry = GroundMatter.of(g.s, freezing: g.y > GroundMatter.snowLine).material().grip
                chassis.gripK[i] = dry > 0 ? min(1, max(0.05, matter.material(wet: wetNow).grip / dry)) : 1
            }
            let paved = matter.rubber
            let loose = !paved && g.s != .water && matter != .ice
            if loose { rough = max(rough, min(1, speed / 25)) }
            // Rubber: paving only (on gravel or grass a slide ploughs, it doesn't mark; ice takes none).
            let side = simd_normalize(SIMD3(right.x, 0, right.z))
            view?.marks?.mark(i, at: ground, side: side, width: 0.25, strength: paved ? Float(s) : Float(0), origin: origin)
            let rp = SIMD3<Float>(ground - origin)
            if FreeDrive.matterOn { matterWheel(i, w, matter, at: ground, rp: rp, side: side, fwd: fwd, v: v, speed: speed, slide: s, crash: crash) }
            if g.s == .water { fordWet = 1 }
            if paved && s > 0.4 {
                smokeAcc[i] += dt * 22 * s
                while smokeAcc[i] >= 1 {
                    smokeAcc[i] -= 1
                    let pv = SIMD3<Float>(v * 0.18) + SIMD3(rnd() - 0.5, 0.5 + rnd() * 0.5, rnd() - 0.5)
                    crash.kick(rp + SIMD3(0, 0.15, 0), pv, size: 0.35 + rnd() * 0.2, grow: 1.6, life: 2.2 + Float(s), alpha: 0.10 + 0.12 * Float(s), color: SIMD3(0.42, 0.42, 0.45))
                }
            } else if (loose || g.s == .water) && speed > 3 {
                // Grit off the tread: thrown back and up, more with speed and with a slide.
                dustAcc[i] += dt * min(28, speed * 1.1) * (0.35 + s)
                let col: SIMD3<Float>
                switch g.s {
                case .sand: col = SIMD3(0.42, 0.36, 0.25)
                case .dirt: col = SIMD3(0.30, 0.23, 0.16)
                case .grass: col = SIMD3(0.26, 0.24, 0.18)   // the soil under it, thrown up, not the green
                case .snow, .water: col = SIMD3(0.6, 0.63, 0.68)
                default: col = SIMD3(0.32, 0.30, 0.26)
                }
                while dustAcc[i] >= 1 {
                    dustAcc[i] -= 1
                    let back = SIMD3<Float>(-fwd * min(speed, 30) * 0.12)
                    let pv = SIMD3<Float>(v * 0.35) + back + SIMD3((rnd() - 0.5) * 1.6, 1.2 + rnd() * 1.8, (rnd() - 0.5) * 1.6)
                    let wet = g.s == .water
                    crash.kick(rp + SIMD3(0, 0.1, 0), pv, size: wet ? 0.3 : 0.3 + rnd() * 0.3, grow: wet ? 2.2 : 1.6, life: wet ? 0.9 : 1.8, alpha: wet ? 0.3 : 0.24, color: col)
                }
            }
        }
        slideK = slide; roughK = max(rough, water?.fx.rumble ?? 0)
        view?.loose?.update(car.world.loose, origin: origin)
        waterFrame(dt)
        if FreeDrive.matterOn {
            fordWet *= exp(-dt / 20)   // a soaked car drains in about a minute
            if !splinters.isEmpty { splinterBurst(crash) }
            dirt.weather(dt: dt, wet: wetness, speed: speed)
            if !noted && (trace?.live ?? 0) + damage.hits > 0 { noted = true; DispatchQueue.main.async { PerfCenter.shared.note(.matter) } }   // 0300's flags
        }
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
        trace?.originMoved()
        track.shift(by: d)
    }

    // MARK: - DriveScene

    func shake(_ a: Float) { camera.shake(a) }
    var carLook: DriveCarLook {
        // Iron starts to show a dull red in the dark at ≈ 400 °C and is orange by ≈ 750 °C.
        func g(_ t: Double) -> Float { let k = Float(max(0, min(1, (t - 380) / 420))); return k * k }
        let d = chassis.discT
        var l = DriveCarLook(glow: ownCar ? SIMD4(g(d[0]), g(d[1]), g(d[2]), g(d[3])) : .zero, pedal: Float(pedal))
        // The water on the car (0320) whatever MATTER does; MATTER's `wetness` reads the same through `wetSource`.
        l.wet = Float(chassis.water.wet); l.wetLine = Float(chassis.water.wetLine)
        if FreeDrive.matterOn {
            let wsum = dirt.wheel.reduce(0, +) / 4
            l.dirt = SIMD4(Float(dirt.sill), Float(dirt.nose), Float(dirt.tail), Float(wsum))
            l.coat = SIMD4(Float(dirt.r), Float(dirt.g), Float(dirt.b), Float(dirt.body))
            l.snow = Float(dirt.snow); l.wet = Float(wetness)
            l.toe = SIMD4(damage.toe.map(Float.init)); l.camber = SIMD4(damage.camber.map(Float.init))
        }
        return l
    }
    var carDamage: CarDamage? { FreeDrive.matterOn ? damage : nil }

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
        let s = sea
        // (and the water's surface: the lens stays above the sea, 0320)
        camera.update(dt: dt, carPos: p, carQuat: q, vel: v, aspect: Double(aspect)) { x, z in max(w.ground(x, z).y, roofUnder(bodies, x, z) + 0.6, s.level(x, z) + 0.3) }
        sea.update(eye: camera.eye)
        let m = camera.matrices(origin: origin, aspect: aspect)
        view?.update(eye: camera.eye, viewProj: m.proj * m.view)
        lastViewProj = m.proj * m.view
        return m
    }

    /// Blue hour (AGENTS.md §1): the sun just under the horizon to the south-west, a cold sky with its last warm band, and
    /// air thin enough to see the ranges 30 km off, thick enough to stack them in blue.
    func look(over base: LookU) -> LookU {
        var k = base
        let sun = simd_normalize(SIMD3<Float>(-0.72, -0.05, -0.69))
        // The sky's fill a little fuller than the stage's (0226): at blue hour the land and the trees still hold their greens
        // under a bright sky; the ground's bounce warmer for the last of the sun.
        k.hemiSky = SIMD4(SIMD3<Float>(0.068, 0.088, 0.15), base.hemiSky.w)
        k.hemiGround = SIMD4(SIMD3<Float>(0.024, 0.022, 0.026), 1)
        k.skyZenith = SIMD4(0.010, 0.018, 0.050, 0); k.skyMid = SIMD4(0.040, 0.062, 0.140, 0); k.skyHorizon = SIMD4(0.26, 0.16, 0.17, 0)
        k.skySun = SIMD4(sun, 0)
        k.hazeCol = SIMD4(0.045, 0.06, 0.105, 1.0 / 9000)
        k.sunCol = SIMD4(0.09, 0.05, 0.045, 1.0 / 1400)
        k.sunDir = SIMD4(sun, base.sunDir.w)
        let nearSlab = origin == .zero && abs(car.pos.x) < 700 && abs(car.pos.z) < 700
        // Off the set the paint reflects the dusk itself, not the stage's cube (0225: Shaders.metal duskEnv).
        k.skySun.w = nearSlab ? 0 : 1
        k.fogExp = SIMD4(0, nearSlab ? base.fogExp.y : 0, 1, base.fogExp.w)
        guard sky.physical else { return k }
        // The physical sky (#365, 0310): the sun where the hour puts it, its light through the air, the haze a little thicker
        // than a clear day's so the ranges stack, the stars once it's dark. One sky over everything, the sets too.
        k.skySun = SIMD4(sky.sun, 1); k.sunDir = SIMD4(sky.sun, base.sunDir.w * 0.6)
        k.atmo = SIMD4(1, 5.0, Float(max(0.0, camera.eye.y) / 1000), sky.night)
        k.sunE = SIMD4(sky.keyColor * sky.keyIntensity, Float(time))
        k.fogExp.z = sky.night > 0.05 ? 1 : 0
        k.hazeCol.w = 0
        // The drawn looks' painted sky and the paint's reflection (duskEnv) in the hour's colours, as radiance at this exposure.
        let c = DriveSky.paintedSky(sunY: sky.sun.y), ex = max(0.05, sky.exposure)
        k.skyZenith = SIMD4(c.zenith / ex, 0); k.skyMid = SIMD4(c.mid / ex, 0); k.skyHorizon = SIMD4(c.horizon / ex, 0)
        k.hemiSky = SIMD4(c.mid * 0.55 / ex, base.hemiSky.w); k.hemiGround = SIMD4(c.ground / ex, 1)
        // The bloom's threshold in the frame as exposed (#365): by day only the sun, its glints and the lamps bloom.
        k.bloom.x = (2.6 + (0.97 - 2.6) * sky.night) / max(0.2, sky.exposure)
        return k
    }
    var key: DriveKey? {
        guard sky.physical else { return nil }
        // Below the horizon the moon takes over: a cold, faint light high in the south-east.
        let moon = simd_normalize(SIMD3<Float>(0.35, 0.62, -0.45))
        let sunUp = smoothstepF(-0.03, 0.02, sky.sun.y)
        let dir = sunUp > 0.5 ? sky.sun : moon
        return DriveKey(dir: dir, color: sunUp > 0.5 ? sky.keyColor : SIMD3(0.62, 0.72, 1.0), intensity: sunUp > 0.5 ? sky.keyIntensity * sunUp : 0.09 * sky.night, exposure: sky.exposure)
    }
    var worldShadow: (map: MTLTexture, vp: simd_float4x4, on: Bool)? { view?.worldShadow }
    var residency: MTLResidencySet? { view?.residency }
    func encodeWorld(_ cmd: MTLCommandBuffer, ring: Int, keyDir: SIMD3<Float>) {
        guard let v = view, let vp = lastViewProj else { return }
        var d = driveU()
        v.encode(cmd, ring: ring, eye: camera.eye, viewProj: vp, car: SIMD3(car.pos.x, car.pos.y, car.pos.z), keyDir: keyDir, drive: &d, look: Look.current, time: time)
    }
    private var lastViewProj: simd_float4x4?

    func drawWorld(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, sky skyTex: MTLTexture, viewProj: simd_float4x4, quality: Int) {
        guard let v = view else { return }
        v.quality = quality
        var d = driveU()
        v.draw(e, frame: frame, look: &look, drive: &d, shadow: shadow, sky: skyTex, viewProj: viewProj, eye: camera.eye, lookMode: Look.current, time: time)
    }
    func drawWorldLate(_ e: MTLRenderCommandEncoder, frame: MTLBuffer, look: inout LookU, shadow: MTLTexture, sky skyTex: MTLTexture, viewProj: simd_float4x4) {
        guard let v = view else { return }
        var d = driveU()
        v.drawLate(e, frame: frame, look: &look, drive: &d, shadow: shadow, sky: skyTex, viewProj: viewProj, eye: camera.eye, lookMode: Look.current, time: time)
    }
    /// The world's uniform this frame: the headlamps, the props' range and the wind, the origin's anchor, the car on the ground.
    private func driveU() -> WDriveU {
        let q = simd_quatd(ix: car.quat.x, iy: car.quat.y, iz: car.quat.z, r: car.quat.w)
        let f = q.act(SIMD3(0, -0.08, 1))
        let lp = SIMD3(car.pos.x, car.pos.y, car.pos.z) + q.act(SIMD3(0, 0.15, 2.0)) - origin
        // The lamps come on as the light goes (#365): full from blue hour, off in daylight.
        let lampOn = sky.physical ? Double(smoothstepF(0.1, 0.55, sky.night)) : 1
        var d = WDriveU(lampPos: SIMD4(SIMD3<Float>(lp), Float(280 * lampK * lampOn)), lampDir: SIMD4(SIMD3<Float>(simd_normalize(f)), cos(0.42)),
                        params: SIMD4(Float(WorldView.propR), Float(time), Launch.args.contains("-fd-lod") ? 1 : 0, 0.6))
        let m = 4096.0
        d.anchor = SIMD4(Float(origin.x - (origin.x / m).rounded(.down) * m), Float(origin.z - (origin.z / m).rounded(.down) * m), Float(WorldView.nearR), Float(view?.quality ?? 2))
        // The car on the ground, for the ground's occlusion under it.
        let c = SIMD3(car.pos.x, car.pos.y - SPEC.comHeight, car.pos.z) - origin
        let fw = q.act(SIMD3(0, 0, 1)), fl = max(1e-6, (fw.x * fw.x + fw.z * fw.z).squareRoot())
        d.carPos = SIMD4(SIMD3<Float>(c), car.grounded > 0 || cruise != nil ? 1 : 0)
        d.carFwd = SIMD4(Float(fw.x / fl), Float(fw.z / fl), 2.3, 1.0)
        return d
    }
    /// The world for the perf line (0310): no spaces (key=value).
    var perfLine: String {
        guard let s = view?.stats else { return "-" }
        return String(format: "tiles:%d,tris:%.0fk,props:%d,propTris:%.0fk,roads:%d,cacheMB:%.0f,bakes:%d,wshadow:%d", s.tiles, Double(s.tris) / 1000, s.instances,
                      Double(view?.props.drawn.tris ?? 0) / 1000, s.roads, s.mb, view?.cache.baked ?? 0, view?.props.shadowDraws ?? 0)
    }

    /// What's under the car (debug, `-fd-stats`).
    var groundLine: String {
        let g = world.ground(car.pos.x, car.pos.z)
        return String(format: "GROUND car (%.1f, %.2f, %.1f) ground %.2f road %.1f m %@ biome %@ low %.1f full %.1f", car.pos.x, car.pos.y, car.pos.z, g.y, g.road, "\(g.surface)", g.land.biome.name, g.land.low, g.land.full)
    }
    /// One line for the debug HUD and the bench.
    var statsLine: String {
        guard let s = view?.stats else { return "" }
        return String(format: "tiles %d · %.0fk tris · roads %d · props %d (%.0fk tris, %d shadow) · %.0f MB · missing %d · %.1f km out · origin (%.0f, %.0f) · marks %d · loose %d · roadside %d standing %d broken",
                      s.tiles, Double(s.tris) / 1000, s.roads, s.instances, Double(view?.props.drawn.tris ?? 0) / 1000, view?.props.drawn.shadow ?? 0, s.mb, s.missing, dist / 1000, origin.x, origin.z, view?.marks?.count ?? 0, view?.loose?.drawn ?? 0, streamer.standingCount, streamer.brokenCount)
            + String(format: " · fx %.0f µs · trace %d slots %d strokes %d dispatches · coat %.2f · hits %d glass %d health %.2f toe %.3f", effectsUs, trace?.live ?? 0, trace?.strokes ?? 0, trace?.dispatches ?? 0, dirt.most, damage.hits, damage.glass.rawValue, damage.health, damage.pull)
    }
}
