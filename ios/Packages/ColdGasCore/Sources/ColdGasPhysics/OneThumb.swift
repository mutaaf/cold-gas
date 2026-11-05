// src/onethumb.js, line for line (0154): one-thumb Assist, the Show and the Wall on a single control.
//   run-up, curl   HOLD to climb (a crawl governor); let go and the car brakes.
//   on the ledge   TAP to let go: it drives out along the ledge and lets go near the lip.
//   flight         HOLD to land (Assist's LAND, plus the carry over the row on the Show); SLIDE to aim the touchdown.
//   touchdown      it brakes to a stop on its own.
// It writes ordinary sim inputs (assist = 1), once per 240 Hz tick; LiveRun samples it (Live.swift).
#if canImport(CRapier)
import ColdGasCore

public enum THUMB {
    public static let crawl = 5.5, climb = 5.0, top = 2.0, slowAt = 0.85, ledgeAt = 0.95, tapAt = 0.92
    public static let push = 36
    public static let carry = 5.5, lip = 0.98
    public static let aimPx = 48.0, aimDead = 0.15, aimPitch = 0.55, aimRoll = 0.45, aimFloor = 1.5, aimFade = 1.0
}
let ROW_MARGIN = 2.5
let AIM_ACC = 6.0, FLANK_T = 2.0, FLANK_PAD = 0.6, FLANK_TOP = 0.8

/// Would the car, carrying on as it is plus a sideways push `ax` (m/s²), come in over a parked flank on the Show
/// below its roof within FLANK_T s?
public func flankAhead(_ c: Vehicle, _ ax: Double) -> Bool {
    let boxes = SHOW.boxes, hw = CAR.halfW + FLANK_PAD, hl = CAR.halfL + FLANK_PAD
    for b in boxes {
        if abs(c.pos.x) < b.maxX + hw { continue }
        var t = 0.25
        while t <= FLANK_T + 1e-9 {
            let x = c.pos.x + c.vel.x * t + 0.5 * ax * t * t, z = c.pos.z + c.vel.z * t
            let bottom = c.pos.y - SPEC.comHeight + jsMin(0, c.vel.y) * t
            if abs(x) < b.maxX + hw && z > b.minZ - hl && z < b.maxZ + hl && bottom < b.maxY + FLANK_TOP { return true }
            t += 0.25
        }
    }
    return false
}
@inline(__always) func rowBehind(_ run: Run, _ c: Vehicle) -> Bool {
    if run.course != "show" { return true }
    let far = SHOW.rowFar - ROW_MARGIN
    return c.pos.z < far && (c.pos.z < far - 4 || c.vel.z < -1)
}
/// A slide (in full-slide units) past the dead zone, rescaled to 0…1 and clamped.
@inline(__always) func thumbShape(_ a: Double) -> Double {
    let m = abs(a)
    if m <= THUMB.aimDead { return 0 }
    return jsSign(a) * jsMin(1, (m - THUMB.aimDead) / (1 - THUMB.aimDead))
}

public enum ThumbStage: String { case idle, climb, ledge, fly, landed }
/// Which part of the flight the thumb is in: what the control says and does.
public func thumbStage(_ run: Run?, _ released: Bool) -> ThumbStage {
    guard let run else { return .idle }
    if run.phase == .landed || run.phase == .done { return .landed }
    if run.phase == .air || released { return .fly }
    if run.phase == .ramp && run.t.progress >= THUMB.tapAt { return .ledge }
    return .climb
}

let tUw = V3(), tFw = V3()
public final class OneThumb {
    var held_ = false, pressed = false, push = 0, drive = false, carried = false, landing_ = false
    var wasStage = ThumbStage.idle, ax = 0.0, ay = 0.0, live = false
    public init() {}
    /// Touch events: `pending` latches a tap shorter than a tick until the next sample reads it.
    public func down() { held_ = true; pressed = true; ax = 0; ay = 0 }
    public func up() { held_ = false; ax = 0; ay = 0 }
    /// The held thumb's slide from where it pressed, points (+x right, +y UP the glass).
    public func move(_ dx: Double, _ dy: Double) { if held_ { ax = dx / THUMB.aimPx; ay = dy / THUMB.aimPx } }
    public func reset() { held_ = false; pressed = false; push = 0; drive = false; carried = false; landing_ = false; wasStage = .idle; ax = 0; ay = 0; live = false }
    public var held: Bool { held_ }
    /// The drive-off is under way (0129), and a press the next tick hasn't read yet: the pad says "Letting go".
    public var driving: Bool { drive }
    public var pending: Bool { pressed }
    /// LAND is on for this flight (0140): the thumb held it once.
    public var landing: Bool { landing_ }
    /// The slide as the pad draws it: −1…1 each way, 0 inside the dead zone.
    public var aim: (x: Double, y: Double) { (thumbShape(ax), thumbShape(ay)) }
    /// Whether the last tick could aim (held, in the air, roof up, high enough, the row allowing).
    public var aimLive: Bool { live }

    /// Fill `out` (cleared: clearInput) for this tick. `steer`: an extra steer (tilt), driver-relative.
    @discardableResult public func sample(_ run: Run, _ released: Bool, _ out: Input, _ steer: Double = 0) -> Input {
        let c = run.car, stage = thumbStage(run, released)
        let v = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
        let press = pressed; pressed = false
        out.assist = 1; out.manual = 0
        live = false
        if stage == .climb || stage == .ledge {
            out.steer = jsMax(-1, jsMin(1, c.pos.x * 0.25 + steer))
            if stage == .ledge && press { drive = true }
            if drive && push == 0 {
                if run.phase == .ramp && wallProgress(c.pos) >= THUMB.lip { push = THUMB.push }
                else { out.throttle = v < THUMB.carry ? 1 : 0; return out }
            }
            if push > 0 { out.lift = 1; push -= 1 }
            else if !held_ { out.brake = 1 }
            else {
                let p = run.phase == .ramp ? wallProgress(c.pos) : 0
                let want = run.phase == .drive ? THUMB.crawl : p >= THUMB.slowAt ? THUMB.top : THUMB.climb
                if run.phase == .ramp && p >= THUMB.ledgeAt { out.brake = 1 }
                else if v < want { out.throttle = 1 }
                else if v > want + 1.5 { out.brake = 1 }
            }
        } else if stage == .fly {
            if push > 0 { out.lift = 1; push -= 1 }
            if run.course == "show" && !carried {
                if -c.vel.z >= THUMB.carry { carried = true } else { out.thrust = 1 }
            }
            if held_ { landing_ = true }
            if landing_ { out.level = 1 }
            if held_ {
                M3.rotate(tUw, c.quat, M3.set(tUw, 0, 1, 0))
                let h = c.pos.y - SPEC.comHeight
                let k = jsMax(0, jsMin(1, (h - THUMB.aimFloor) / THUMB.aimFade))
                if tUw.y > 0.94 && k > 0 {
                    let clear = rowBehind(run, c)
                    if clear { out.pitch = k * THUMB.aimPitch * thumbShape(ay) }
                    var roll = k * THUMB.aimRoll * thumbShape(ax)
                    if roll != 0 && run.course == "show" && !clear {
                        M3.rotate(tFw, c.quat, M3.set(tFw, 0, 0, 1))
                        if flankAhead(c, roll * -tFw.z * AIM_ACC + 9.81 * tUw.x) { roll = 0 }
                    }
                    live = true
                    out.roll = roll
                }
            }
        } else if stage == .landed {
            out.brake = 1
        }
        wasStage = stage
        return out
    }
}

/// The pad's sight (src/thumb-aim.js draws it): the mark from the predicted touchdown, px on the pad in the car's frame
/// (x right, y DOWN the glass, so up = further along its nose), clamped inside the ring. A thumb put on it slides
/// AIM_PX_PER_M × the miss. `m`: the miss, metres.
public let AIM_PX_PER_M = 6.0, AIM_R = 44.0
let mFw = V3()
public func markOffset(_ c: Vehicle, _ pr: Prediction, _ course: String) -> (x: Double, y: Double, m: Double) {
    let pad = (COURSES[course] ?? SHOW).pad ?? SHOW.pad!
    M3.rotate(mFw, c.quat, M3.set(mFw, 0, 0, 1))
    let ez = pad.z - pr.landZ, ex = pad.x - pr.landX
    let along = ez * mFw.z + ex * mFw.x, side = ez * mFw.x - ex * mFw.z
    var x = side * AIM_PX_PER_M, y = -along * AIM_PX_PER_M
    let d = DMath.dhypot(x, y, 0)
    if d > AIM_R { x *= AIM_R / d; y *= AIM_R / d }
    return (x, y, DMath.dhypot(ez, ex, 0))
}
#endif
