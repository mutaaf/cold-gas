// The driver's hands and the classic touch controls (0154), line for line:
//   src/hands.js      stickShape, the hands (a steering target and two pedals per 240 Hz tick)
//   src/driving.js    the driving levels (Easy / Standard / Advanced) on a scored run's ground: createDriver's tick
//                     with no road (AI drive and Easy's road aids need Free Drive's road; a scored run has none)
//   src/input.js      sample(): touch (the stick with its 15 % dead zone, GO / BRAKE / LIFT / LAND, the ground's
//                     wheel through the level, the air's stick), plus the keyboard and gamepad channels it mixes in
//   touch-settings.js the tilt's quantisation (TouchControls.tiltSteer)
// The touch path is held to the JS's bits by Tests/Vectors/input (LiveInputTests). The keyboard and gamepad paths are
// ported as written but no vector drives them yet.
#if canImport(CRapier)
import ColdGasCore

// MARK: - hands.js

let KEY_IN = 4.0 / 240, KEY_OUT = 8.0 / 240, STICK_RATE = 4.0

/// An analog stick on the ground: a dead zone that starts from zero at its edge, then a mild expo.
@inline(__always) public func stickShape(_ v: Double, _ dead: Double = 0.12, _ expo: Double = 0.45) -> Double {
    let a = abs(v)
    if a <= dead { return 0 }
    let x = jsMin(1, (a - dead) / (1 - dead))
    return jsSign(v) * x * (1 - expo + expo * x * x)
}

public final class Hands {
    public private(set) var ax = 0.0, thr = 0.0, brk = 0.0
    public init() {}
    public func reset() { ax = 0; thr = 0; brk = 0 }
    public func hold(_ a: Double) { ax = jsMax(-1, jsMin(1, a)) }
    /// A steering target in [−1, 1] at ground speed v (m/s); `analog`: a stick (STICK_RATE times a key's rate).
    @discardableResult public func steer(_ target: Double, _ v: Double = 0, _ analog: Bool = false) -> Double {
        let a = ax
        let into = abs(target) > abs(a) && jsSign(target) != -jsSign(a)
        let rate = (into ? KEY_IN / (1 + v / 12) : KEY_OUT) * (analog ? STICK_RATE : 1)
        ax = a + jsMax(-rate, jsMin(rate, target - a))
        return ax
    }
    @inline(__always) func pedal(_ cur: Double, _ on: Bool, _ tIn: Double) -> Double {
        jsMax(0, jsMin(1, cur + (on ? 1 / (240 * tIn) : -2 / (240 * tIn))))
    }
    @discardableResult public func pedals(_ up: Bool, _ down: Bool) -> (thr: Double, brk: Double) {
        thr = pedal(thr, up, 0.3); brk = pedal(brk, down, 0.15)
        return (thr, brk)
    }
}

// MARK: - driving.js (a scored run's ground)

public enum DriveLevel: String { case easy, standard, advanced }

/// The stick on the ground, per level and kind (touch or pad).
@inline(__always) public func shapeStick(_ level: DriveLevel, _ x: Double, touch: Bool) -> Double {
    switch level {
    case .advanced: return stickShape(x, touch ? 0.08 : 0.06, 0)
    case .easy: return stickShape(x, touch ? 0.2 : 0.16, 0.6)
    case .standard: return touch ? stickShape(x, 0.15, 0.3) : stickShape(x)
    }
}

public enum EASY {
    public static let steerV0 = 15.0, steerV1 = 60.0, steerMin = 0.6, pedalIn = 0.6, ellipse = 0.7
    public static let slip0 = 0.06, slipK = 2.2, slipCut = 8.0
}
let ADV_KEY_T = 0.08
let COM_TO_REAR_AXLE = SPEC.wheelbase - SPEC.comFromFront

/// What the devices hand the driving level each ground tick (driving.js `raw`): keyAx −1/0/1, stickAx already shaped
/// (shapeStick), tilt, digital pedals, analog pedals 0…1.
public struct GroundRaw {
    public var keyAx = 0.0, stickAx = 0.0, tilt = 0.0, up = false, down = false, thrA = 0.0, brkA = 0.0
    public init() {}
}

public final class Driver {
    public let hands = Hands()
    public private(set) var level: DriveLevel
    var thrE = 0.0, kAx = 0.0
    public private(set) var lastSteer = 0.0, lastThr = 0.0
    /// What Easy's slide catch did on the last tick (driving.js aid.catch).
    public private(set) var aidCatch = 0.0
    public init(_ level: DriveLevel = .standard) { self.level = level }
    public func set(_ l: DriveLevel) { if l != level { reset() }; level = l }
    public func reset() { hands.reset(); thrE = 0; lastSteer = 0; kAx = 0 }
    /// Where the wheel the player holds is (Advanced: the delivered steer, there are no hands).
    public var ax: Double { level == .advanced ? lastSteer : hands.ax }

    /// One ground tick (driving.js tick with ctx null): the steer, throttle and brake.
    public func tick(_ raw: GroundRaw, _ car: Vehicle?) -> (steer: Double, throttle: Double, brake: Double) {
        // carState: horizontal and forward speed, and the rear axle's slip (+ = the velocity left of the nose).
        var v = 0.0, vf = 0.0, beta = 0.0
        if let car {
            let q = car.quat
            let fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
            v = jsSqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z)
            vf = car.vel.x * fx + car.vel.z * fz
            let vl = car.vel.x * fz - car.vel.z * fx
            // The one place this differs from the JS, on purpose: driving.js calls Math.atan2 here, which engines don't
            // promise to the bit (on Node 25, arm64, it differs from dmath by an ulp on 0.12 % of inputs). dmath's is
            // the same everywhere, and it feeds only Easy's slide catch, which the log then quantises to hundredths.
            beta = vf > 3 ? DMath.datan2(vl - car.angVel.y * COM_TO_REAR_AXLE, vf) : 0
        }
        aidCatch = 0
        var steer: Double, thr: Double, brk: Double
        switch level {
        case .advanced:
            let kt = raw.keyAx
            kAx += M3.clamp(kt - kAx, -1 / (240 * ADV_KEY_T), 1 / (240 * ADV_KEY_T))
            steer = M3.clamp(kAx + raw.stickAx + raw.tilt, -1, 1)
            thr = jsMax(raw.up ? 1 : 0, raw.thrA)
            brk = jsMax(raw.down ? 1 : 0, raw.brkA)
        case .easy:
            let target = M3.clamp(raw.keyAx + raw.stickAx + raw.tilt, -1, 1)
            let analog = raw.keyAx == 0 && target != 0
            let a = hands.steer(target, v, analog)
            let gain = v > EASY.steerV0 ? jsMax(EASY.steerMin, 1 / (1 + (v - EASY.steerV0) / EASY.steerV1)) : 1
            steer = a * gain
            thrE = M3.clamp(thrE + (raw.up ? 1 / (240 * EASY.pedalIn) : -2 / (240 * EASY.pedalIn)), 0, 1)
            let p = hands.pedals(false, raw.down)
            thr = jsMax(thrE, raw.thrA)
            brk = jsMax(p.brk, raw.brkA)
            if car != nil {
                thr = jsMin(thr, 1 - EASY.ellipse * abs(steer) * M3.clamp((v - 5) / 15, 0, 1))
                let b = beta, bx = b > EASY.slip0 ? b - EASY.slip0 : b < -EASY.slip0 ? b + EASY.slip0 : 0
                if bx != 0 && v > 5 {
                    steer -= EASY.slipK * bx
                    thr *= M3.clamp(1 - EASY.slipCut * abs(bx), 0, 1)
                    aidCatch = abs(bx)
                }
            }
            steer = M3.clamp(steer, -1, 1)
        case .standard:
            let ka = raw.keyAx, sa = raw.stickAx
            steer = hands.steer(M3.clamp(ka + sa, -1, 1), v, ka == 0 && sa != 0) + raw.tilt
            let p = hands.pedals(raw.up, raw.down)
            thr = jsMax(p.thr, raw.thrA)
            brk = jsMax(p.brk, raw.brkA)
        }
        lastSteer = steer; lastThr = thr
        return (steer, thr, brk)
    }
}

// MARK: - input.js: the controls

/// The classic touch controls as src/input.js holds them (`touch`): the stick, GO / BRAKE / LIFT / LAND.
public final class TouchControls {
    public enum Button { case go, brk, lift, land }
    /// A finger has used the controls (input.js sets it on any press and never clears it).
    public private(set) var active = false
    public private(set) var x = 0.0, y = 0.0
    public private(set) var lift = false, land = false, go = false, brk = false
    public private(set) var goAmt = 1.0, brkAmt = 1.0
    public init() {}
    /// The stick's knob, −1…1 each way, inside the unit disc (input.js: the offset over its 56 px radius, clamped to
    /// the ring), +x right, +y DOWN the glass. Down or moved.
    public func stick(_ x: Double, _ y: Double) { active = true; self.x = x; self.y = y }
    public func stickUp() { x = 0; y = 0 }
    /// The knob from a touch's offset in points from the stick's centre (input.js move, its 56 pt radius).
    public static func stickXY(dx: Double, dy: Double, radius: Double = 56) -> (x: Double, y: Double) {
        var dx = dx, dy = dy
        let l = (dx * dx + dy * dy).squareRoot()
        if l > radius { dx *= radius / l; dy *= radius / l }
        return (dx / radius, dy / radius)
    }
    /// `amount`: GO's or BRAKE's travel (pedalAmount; Advanced driving's analog pedals). Ignored for LIFT and LAND.
    /// Call again as the finger slides on a held pedal (input.js's pointermove).
    public func press(_ b: Button, amount: Double = 1) {
        active = true
        switch b { case .go: go = true; goAmt = amount; case .brk: brk = true; brkAmt = amount; case .lift: lift = true; case .land: land = true }
    }
    public func release(_ b: Button) {
        switch b { case .go: go = false; case .brk: brk = false; case .lift: lift = false; case .land: land = false }
    }
    /// Everything let go (blur, pause, a new run: input.js resetTouch). `active` stays, as in the JS.
    public func reset() { x = 0; y = 0; lift = false; land = false; go = false; brk = false }
    /// A finger near the top of an Advanced pedal is full; near the bottom about a third. fy: 0 top … 1 bottom.
    public static func pedalAmount(_ fy: Double) -> Double { jsMax(0.35, jsMin(1, 0.35 + 0.65 * (1 - fy))) }
    /// touch-settings.js: the steer for a phone rolled `roll`° from `zero` (±20° full lock, a 3° dead zone, 5 % steps).
    public static func tiltSteer(roll: Double, zero: Double) -> Double {
        var d = roll - zero
        d = abs(d) < 3 ? 0 : d - jsSign(d) * 3
        return jsRound(jsMax(-1, jsMin(1, d / (20 - 3))) * 20) / 20
    }
}

/// Keys as src/input.js reads them (held = true). For a hardware keyboard later; zero by default.
public struct KeyState {
    public var left = false, right = false, up = false, down = false, yawLeft = false, yawRight = false
    public var lift = false, land = false, boost = false
    public init() {}
}
/// A gamepad as input.js reads one (the standard mapping): axes 0–3; buttons 0 A, 1 B, 5 RB, 6 LT, 7 RT.
public struct PadState {
    public var axes: [Double] = [0, 0, 0, 0]
    public var pressed: [Bool] = Array(repeating: false, count: 18)
    public var value: [Double] = Array(repeating: 0, count: 18)
    public init() {}
}

let STICK_DEAD = 0.15
@inline(__always) func deadzone(_ v: Double) -> Double { abs(v) < STICK_DEAD ? 0 : (jsSign(v) * (abs(v) - STICK_DEAD)) / (1 - STICK_DEAD) }
@inline(__always) func dz12(_ v: Double) -> Double { abs(v) < 0.12 ? 0 : v }

/// src/input.js sample(): the controls into one tick's sim input. Owns the touch controls, the driver (the ground's
/// hands, also the air's roll filter), the tilt, and the keyboard / gamepad / nozzle-pad channels.
public final class InputSampler {
    public let touch = TouchControls()
    public let driver: Driver
    public var hands: Hands { driver.hands }
    /// The tilt's steer this tick (TouchControls.tiltSteer; 0 when tilt steering is off).
    public var tilt = 0.0
    public var keys = KeyState()
    public var pads: [PadState] = []
    /// Advanced flight's valves: the nozzle pad's (0…1, NOZZLE_SPEC order) and the keys' ramp (valves.js); the larger.
    public var nozzleValves = [Double](repeating: 0, count: 10)
    public var keyValves = [Double](repeating: 0, count: 10)
    var raw = GroundRaw()
    public init(level: DriveLevel = .standard) { driver = Driver(level) }
    /// A new run: let go of everything, the hands from rest (input.js freshRun).
    public func freshRun() { touch.reset(); driver.reset(); for k in 0..<10 { nozzleValves[k] = 0; keyValves[k] = 0 } }

    /// `released`: the car has let go of the Wall. Fills `out` and returns it.
    @discardableResult
    public func sample(_ phase: Phase, _ tier: FlyTier, _ out: Input, _ released: Bool = false, _ car: Vehicle? = nil) -> Input {
        clearInput(out)
        out.assist = tier == .assist ? 1 : 0
        out.manual = tier == .advanced ? 1 : 0
        let air = phase == .air || (phase == .ramp && released)
        var ax = 0.0, ay = 0.0, lift = 0.0, land = 0.0, thr = 0.0, brk = 0.0, yaw = 0.0
        var v = 0.0
        if !air, let car { v = jsSqrt(car.vel.x * car.vel.x + car.vel.z * car.vel.z) }
        let lvl = driver.level
        let stickGround = touch.active && !air ? shapeStick(lvl, touch.x, touch: true) : 0
        var padGround = 0.0
        if !air { for p in pads { padGround += shapeStick(lvl, p.axes[0], touch: false) } }
        let keyAx = (keys.right ? 1.0 : 0) - (keys.left ? 1.0 : 0), stickAx = stickGround + padGround
        if air { ax = driver.hands.steer(jsMax(-1, jsMin(1, keyAx + stickAx)), v, keyAx == 0 && stickAx != 0) }
        if keys.up { ay -= 1 }
        if keys.down { ay += 1 }
        if keys.yawLeft { yaw -= 1 }
        if keys.yawRight { yaw += 1 }
        if keys.lift { lift = 1 }
        if keys.land { land = 1 }
        var boost = keys.boost ? 1.0 : 0
        let tGo = touch.active && touch.go && !air, tBrk = touch.active && touch.brk && !air
        if air { let p = driver.hands.pedals(ay < 0 || tGo, ay > 0 || tBrk); thr = p.thr; brk = p.brk }

        var thrA = 0.0, brkA = 0.0
        for p in pads {
            let rt = p.value[7], lt = p.value[6]
            if !air {
                thrA = jsMax(thrA, rt); brkA = jsMax(brkA, lt)
                if p.pressed[0] { lift = 1 }
                continue
            }
            if truthy(out.manual) { continue }
            ax += dz12(p.axes[0])
            ay += dz12(p.axes[1])
            yaw += dz12(p.axes[2]) * 0.8
            lift = jsMax(lift, jsMax(rt, p.pressed[0] ? 1 : 0)); land = jsMax(land, lt > 0.3 || p.pressed[1] ? 1 : 0)
            if p.pressed[5] { boost = 1 }
        }
        if !air {
            let adv = lvl == .advanced
            raw.keyAx = keyAx; raw.stickAx = stickAx; raw.tilt = tilt
            raw.up = ay < 0 || (tGo && !adv); raw.down = ay > 0 || (tBrk && !adv)
            raw.thrA = jsMax(thrA, tGo && adv ? touch.goAmt : 0); raw.brkA = jsMax(brkA, tBrk && adv ? touch.brkAmt : 0)
            let d = driver.tick(raw, car)
            ax = d.steer; thr = d.throttle; brk = d.brake
        }
        if touch.active {
            if air { ax += deadzone(touch.x); ay -= deadzone(touch.y) }
            if touch.lift { lift = 1 }
            if touch.land { land = 1 }
            if touch.go && air { thr = 1; boost = 1 }
            if touch.brk && air { brk = 1 }
        }
        ax = jsMax(-1, jsMin(1, ax)); ay = jsMax(-1, jsMin(1, ay))

        if truthy(out.manual) {
            // input.js advanced(): off the Wall the valves are yours; on the ground you drive.
            if !air { out.steer = ax; out.throttle = thr; out.brake = brk; out.lift = lift; return out }
            for k in 0..<10 { out.v[k] = jsMax(keyValves[k], nozzleValves[k]) }
            out.lift = lift
            return out
        }
        if air {
            out.roll = ax; out.pitch = -ay; out.yaw = yaw; out.lift = lift; out.level = land; out.thrust = boost
        } else {
            out.steer = ax; out.throttle = thr; out.brake = brk; out.lift = lift
            out.thrust = phase == .drive && truthy(land) && !truthy(brk) ? 1 : 0
        }
        return out
    }
}
#endif
