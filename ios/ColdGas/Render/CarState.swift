// The car's own animated states (src/render/roadster.js update), read from what the renderer sees, as on the web: the car's
// motion gives speed and braking, the wheels whether it's on the ground, the sim's fan the skirts. Once per rendered frame,
// on the real clock (S.time), nothing allocated:
//   wake     a new placement (a jump of more than 3 m): the lights sweep on, the headlamp covers drop
//   lamps    DRL, heads, the tail bar and its dim strip, the brake section, amber repeaters, markers, plate lamps, ambient
//   aero     the wing deploying with speed, kicking up as an airbrake; the intake vanes and barge boards following it
//   skirts   dropping with the fan; the end skirts lifting above ≈50 mph; the rotors spinning at the fan's level
//   nozzles  a bright core in each open throat, rime building on the lip with use
//   damage   crash.js's hooks: torn-off parts hidden, lamps flickering or dead, hazards, the crazed canopy
import simd
import ColdGasCore
import ColdGasPhysics

func rotX(_ a: Float) -> simd_float4x4 { let c = cos(a), s = sin(a); return simd_float4x4(columns: (SIMD4(1, 0, 0, 0), SIMD4(0, c, s, 0), SIMD4(0, -s, c, 0), SIMD4(0, 0, 0, 1))) }
func rotY(_ a: Float) -> simd_float4x4 { let c = cos(a), s = sin(a); return simd_float4x4(columns: (SIMD4(c, 0, -s, 0), SIMD4(0, 1, 0, 0), SIMD4(s, 0, c, 0), SIMD4(0, 0, 0, 1))) }
func rotZ(_ a: Float) -> simd_float4x4 { let c = cos(a), s = sin(a); return simd_float4x4(columns: (SIMD4(c, s, 0, 0), SIMD4(-s, c, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(0, 0, 0, 1))) }
func scaleM(_ x: Float, _ y: Float, _ z: Float) -> simd_float4x4 { simd_float4x4(diagonal: SIMD4(x, y, z, 1)) }

final class CarState {
    enum Group: Int, CaseIterable { case wing, skirts, vanes, barge }        // roadster.js st.broken
    enum Source { case wing, vanes, barge, sideSkirts, endSkirts }           // crash.js's `src`: what a piece leaves from

    private var last = -1.0, wakeT0 = 0.0, has = false
    private var pos = SIMD3<Float>(), prev = SIMD3<Float>()
    private var vf: Float = 0, acc: Float = 0, decel: Float = 0, speed: Float = 0, grounded = true, brakeHold: Float = 0
    private var wingExt: Float = 0, wingExtT = -1.0
    private(set) var wake: Float = 0, sweep: Float = 0, lampsOn: Float = 0, brake: Float = 0
    private(set) var fan: Float = 0, skirtSide: Float = 0, skirtEnd: Float = 0, fanAngle: Float = 0
    private(set) var wing: Float = 0, airbrake: Float = 0
    private(set) var core = [Float](repeating: 0, count: 10), frost = [Float](repeating: 0, count: 10)
    /// Lamp colours this frame (setLamp), linear.
    private(set) var drl = SIMD3<Float>(), headC = SIMD3<Float>(), tail = SIMD3<Float>(), tailDim = SIMD3<Float>(), brakeC = SIMD3<Float>()
    private(set) var amber = SIMD3<Float>(), marker = SIMD3<Float>(), plate = SIMD3<Float>(), ambient = SIMD3<Float>()
    // Damage (crash.js).
    var broken = [Bool](repeating: false, count: Group.allCases.count)
    var crazed = false
    private var dmgHead: Float = 1, dmgTail: Float = 1, hazard = false
    /// The wing's pose when it tore off (crash.js syncPose copies it onto the flying clone).
    private(set) var tornK: Float = 0, tornAir: Float = 0

    func isBroken(_ g: Group) -> Bool { broken[g.rawValue] }
    func setDamage(head: Float, tail: Float, hazard h: Bool) { dmgHead = head; dmgTail = tail; hazard = h }
    func keepTornWing() { tornK = wing; tornAir = airbrake }
    /// A new placement the 3 m jump can't see: wake on the next frame (hero.placed).
    func placed() { has = false }
    func reset() { for i in broken.indices { broken[i] = false }; crazed = false; dmgHead = 1; dmgTail = 1; hazard = false; for i in frost.indices { frost[i] = 0 } }
    /// main.js: live only, `setWing((speed - 20) / 20)`; it counts for 0.3 s.
    func setWing(_ t: Float) { wingExt = min(1, max(0, t)); wingExtT = last }
    /// Free Drive (0225): the brake pedal itself (−1: none; the lamps then follow the car's deceleration, as on the web).
    var pedal: Float = -1

    private func smooth(_ a: Float, _ b: Float, _ t: Float) -> Float { let k = min(1, max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k) }
    private func ease(_ cur: Float, _ target: Float, _ dt: Float, _ tau: Float) -> Float { cur + (target - cur) * (1 - exp(-dt / tau)) }

    /// `time`: the real clock (S.time); `groundedNow`: any wheel loaded (the sim reports droop as compression 0).
    func update(time: Double, carPos: SIMD3<Float>, carQuat q: simd_quatf, groundedNow: Bool, fanLevel: Float, throttle thr: [Float]) {
        let dt = last < 0 ? 0 : Float(min(0.1, max(0, time - last)))
        last = time
        pos = carPos + q.act(SIMD3(0, -Float(SPEC.comHeight), 0))
        fan = min(1, max(0, fanLevel))
        if !has || simd_distance(pos, prev) > 3 {
            wakeT0 = time; vf = 0; acc = 0; brakeHold = 0
            prev = pos; has = true
        }
        wake = Float(time - wakeT0)
        if dt > 0 {
            let fwd = q.act(SIMD3(0, 0, 1)), v = (pos - prev) / dt
            speed = ease(speed, simd_length(v), dt, 0.15)
            let vfNow = ease(vf, simd_dot(v, fwd), dt, 0.06)
            acc = ease(acc, (vfNow - vf) / dt, dt, 0.08)
            vf = vfNow
            grounded = groundedNow
            // Braking: decelerating hard on the wheels beyond what the slope explains, held briefly after the car stops.
            decel = acc + 9.81 * fwd.y
            if grounded && vf > 0.3 && decel < -2.5 && pedal < 0 { brakeHold = 0.6 }
            if pedal > 0.05 { brakeHold = max(brakeHold, 0.15) }
            else if grounded && abs(vf) < 0.3 && brakeHold > 0 { brakeHold = max(brakeHold, 0.3) }
            brakeHold = max(0, brakeHold - dt)
        }
        prev = pos
        // Active aero: deploys with speed or when main says so; kicks up as an airbrake under hard braking at speed.
        let ext: Float = last - wingExtT < 0.3 ? wingExt : 0
        wing = ease(wing, max(ext, smooth(18, 36, speed)), dt, 0.5)
        airbrake = ease(airbrake, grounded && speed > 22 && decel < -9 ? 1 : 0, dt, 0.25)
        // Skirts drop with the fan; front and rear lift above ≈50 mph for the venturi mode.
        let on: Float = fan > 0.01 ? 1 : 0
        skirtSide = ease(skirtSide, on, dt, 0.25)
        skirtEnd = ease(skirtEnd, on > 0 && speed < 22 ? 1 : 0, dt, 0.25)
        fanAngle += dt * fan * 70
        // Lights.
        let t = wake
        sweep = smooth(0.15, 0.85, t); lampsOn = smooth(0.85, 1.15, t)
        let flare = 1 + 0.7 * max(0, 1 - abs(t - 1.25) / 0.25)
        // After a crash: hazards blink at 1.5 Hz (amber repeaters, and the red bar, as rear signals do).
        let blink: Int = hazard ? (time * 1.5).truncatingRemainder(dividingBy: 1) < 0.5 ? 1 : 0 : -1
        let tailK = dmgTail * (blink < 0 ? 1 : blink == 1 ? 1.5 : 0.25)
        drl = SIMD3(0.92, 0.96, 1) * (3.2 * min(1, sweep * 1.4) * dmgHead)
        headC = SIMD3(0.95, 0.97, 1) * (6 * lampsOn * flare * dmgHead)
        brake = ease(brake, brakeHold > 0 ? 1 : 0, dt, brakeHold > 0 ? 0.04 : 0.12)
        tail = SIMD3(1, 0.08, 0.1) * ((1.7 + 3.5 * brake) * sweep * tailK)
        tailDim = SIMD3(1, 0.08, 0.1) * ((0.6 + 1.2 * brake) * sweep * tailK)
        brakeC = SIMD3(1, 0.1, 0.12) * (9 * brake * sweep * dmgTail)
        let markers = smooth(0.9, 1.05, t)
        amber = SIMD3(1, 0.55, 0.12) * (2.2 * markers * (blink < 0 ? 1 : blink == 1 ? 3.5 : 0.08))
        marker = SIMD3(1, 0.08, 0.1) * (2.4 * markers)
        plate = SIMD3(1, 1, 1) * (1.6 * markers)
        ambient = SIMD3(1, 0.12, 0.1) * (2.2 * smooth(0, 0.6, t))
        // A bright jet core in each throat while its valve is open; rime on the lip that thaws over a few seconds.
        for i in 0..<10 {
            let p = min(1, max(0, thr[i]))
            core[i] = p
            frost[i] = min(1, frost[i] + p * dt * 0.9) * exp(-dt / 4.5)
        }
    }

    // --- The moving parts' poses, in the car's ground frame (applyWing, applySkirts, applyLights) ----------------------
    var vanesRotX: Float { -(0.15 + 0.95 * max(wing, airbrake)) }
    var bargeX: Float { 0.955 + 0.06 * max(wing, airbrake) }
    var sideSkirtsShown: Bool { skirtSide > 0.01 && !isBroken(.skirts) }
    var endSkirtsShown: Bool { skirtEnd > 0.01 && !isBroken(.skirts) }
    func rise(_ k: Float, _ air: Float) -> Float { 0.3 * min(1, k + air) }
    /// wingPivot in the wing's own frame.
    func wingPivot(_ k: Float, _ air: Float) -> simd_float4x4 { translate(SIMD3(0, rise(k, air), -0.04 * k)) * rotX(0.16 * k + 0.75 * air) }

    /// A source's visibility as crash.js reads `b.src.visible`.
    func visible(_ s: Source) -> Bool {
        switch s {
        case .wing: return !isBroken(.wing)
        case .vanes: return !isBroken(.vanes)
        case .barge: return !isBroken(.barge)
        case .sideSkirts: return sideSkirtsShown
        case .endSkirts: return endSkirtsShown
        }
    }
    /// A source's world matrix and rotation (b.src.matrixWorld decomposed).
    func world(_ s: Source, layout l: CarLayout, carPos: SIMD3<Float>, carQuat: simd_quatf) -> (simd_float4x4, simd_quatf) {
        let carM = translate(carPos) * simd_float4x4(carQuat) * translate(SIMD3(0, -Float(SPEC.comHeight), 0))
        let xAxis = SIMD3<Float>(1, 0, 0)
        switch s {
        case .wing: return (carM * translate(l.wingPos) * rotX(l.wingRotX), carQuat * simd_quatf(angle: l.wingRotX, axis: xAxis))
        case .vanes: return (carM * translate(l.vanesPos) * rotX(vanesRotX), carQuat * simd_quatf(angle: vanesRotX, axis: xAxis))
        case .barge: return (carM * scaleM(bargeX, 1, 1), carQuat)
        case .sideSkirts: return (carM * translate(SIMD3(0, -0.11 * skirtSide, 0)), carQuat)
        case .endSkirts: return (carM * translate(SIMD3(0, -0.11 * skirtEnd, 0)), carQuat)
        }
    }
}
