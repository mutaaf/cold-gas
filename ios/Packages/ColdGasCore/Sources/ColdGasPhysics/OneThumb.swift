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
// 0164: the sideways slide's loop (src/onethumb.js, the same numbers and the same order of operations).
let HOLD_K = 0.07, HOLD_ROLL = (3.0 * 2.0) / (1.6 * 4.6), HOLD_TAU = 1.8
let AIM_RING = 6.0, AIM_TGO = 0.6, AIM_GAIN = 3.0, AIM_BANK = 0.55
// 0164 (the tapped thumb): the place is taken once it holds still and the slide can act; aim past 0.8 roof up once slid;
// the bank tapers near the floor (src/onethumb.js says why).
let REF_STEADY = 2.0, REF_WIN = 24, REF_WINS = 2, AIM_UY_SLID = 0.8, AIM_LOW = 0.5, AIM_LOW_H = 2.0
// 0177: a hold pressed again in the air on the Wall reads the place with REF_LEAK of the fall through the bank, acts on
// its first roof-up tick, and never rolls less than LAND's own hold the way slid (src/onethumb.js says why).
let REF_LEAK = 0.2, HOLD_BANK = 0.2
/// A point's side in the car's frame: + = the car's right (the pad's sight's +x).
@inline(__always) func sideOf(_ x: Double, _ z: Double, _ f: V3) -> Double { z * f.x - x * f.z }
/// The tallest parked roof on the Show (the first of the tallest); an inward slide waits until it is behind (0164).
let TALL: ParkedBox = { var t = SHOW.boxes[0]; for b in SHOW.boxes where b.maxY > t.maxY { t = b }; return t }()
@inline(__always) func tallAhead(_ c: Vehicle) -> Bool { c.pos.z > TALL.minZ - CAR.halfL }
// 0165: along the run the slide is a place too, on the Show, once the brake has turned the fall (src/onethumb.js says why).
let PITCH_ACC = 5.5, SHORT_TOP = 1.0, PITCH_FLOOR = 2.5
let SHOW_END = SHOW.rowFar - CAR.halfL - ROW_MARGIN
/// The Show's roofs the car hasn't passed and is over (or will be, sideways, as it passes them): is its floor still
/// clear of them + SHORT_TOP when its back is past the last?
func shortRoom(_ c: Vehicle, _ h: Double) -> Bool {
    let hw = CAR.halfW + FLANK_PAD, hl = CAR.halfL + FLANK_PAD
    var roof = -Double.infinity, end = Double.infinity
    let tAll = jsMax(0, (c.pos.z - (SHOW.rowFar - hl)) / jsMax(0.5, -c.vel.z)), xEnd = c.pos.x + c.vel.x * tAll
    for b in SHOW.boxes {
        if b.minZ - hl >= c.pos.z { continue }
        if jsMin(abs(c.pos.x), abs(xEnd)) >= b.maxX + hw && jsSign(c.pos.x) == jsSign(xEnd) { continue }
        roof = jsMax(roof, b.maxY); end = jsMin(end, b.minZ - hl)
    }
    if roof == -Double.infinity { return true }
    let tPass = (c.pos.z - end) / jsMax(0.5, -c.vel.z)
    return h + jsMin(0, c.vel.y) * tPass > roof + SHORT_TOP
}
/// 0165: is the car's footprint over a parked roof now? (LAND holds it there; predict reads short.)
func overRoof(_ c: Vehicle) -> Bool {
    for b in SHOW.boxes where abs(c.pos.x) < b.maxX + CAR.halfW && c.pos.z > b.minZ - CAR.halfL && c.pos.z < b.maxZ + CAR.halfL { return true }
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

let tUw = V3(), tFw = V3(), tBx = V3()
public final class OneThumb {
    var airPress = false, held_ = false, pressed = false, push = 0, drive = false, carried = false, landing_ = false
    var wasStage = ThumbStage.idle, ax = 0.0, ay = 0.0, live = false, ref_ = Double.nan, wait = false, slid = false
    var steady = 0, ref0 = Double.nan, win = 0
    var refA_ = Double.nan, slidA = false, pk = 0.0, braked = false, canA_ = false
    let pr = Prediction()
    public init() {}
    /// Touch events: `pending` latches a tap shorter than a tick until the next sample reads it.
    public func down() { held_ = true; pressed = true; ax = 0; ay = 0; ref_ = .nan; steady = 0; ref0 = .nan; slid = false; refA_ = .nan; slidA = false }
    public func up() { held_ = false; ax = 0; ay = 0; ref_ = .nan; steady = 0; ref0 = .nan; slid = false; refA_ = .nan; slidA = false }
    /// The held thumb's slide from where it pressed, points (+x right, +y UP the glass).
    public func move(_ dx: Double, _ dy: Double) { if held_ { ax = dx / THUMB.aimPx; ay = dy / THUMB.aimPx } }
    public func reset() { airPress = false; held_ = false; pressed = false; push = 0; drive = false; carried = false; landing_ = false; wasStage = .idle; ax = 0; ay = 0; live = false; ref_ = .nan; steady = 0; ref0 = .nan; slid = false; refA_ = .nan; slidA = false; pk = 0; braked = false; canA_ = false }
    /// 0164: where the sideways slide is measured from (m, the car's right +), NaN before this hold could aim.
    public var ref: Double { ref_ }
    /// 0165: where the up/down slide is measured from (m along the car's nose), NaN before this hold could aim.
    public var refA: Double { refA_ }
    /// 0165: whether the up/down slide can act this tick (markOffset's `canA`).
    public var canA: Bool { canA_ }
    /// The held thumb's sideways slide, points, as far as it counts (a full slide): where the pad draws the ink dot.
    public var slidePx: Double { jsMax(-1, jsMin(1, ax)) * THUMB.aimPx }
    public var held: Bool { held_ }
    /// The drive-off is under way (0129), and a press the next tick hasn't read yet: the pad says "Letting go".
    public var driving: Bool { drive }
    public var pending: Bool { pressed }
    /// LAND is on for this flight (0140): the thumb held it once.
    public var landing: Bool { landing_ }
    /// The slide as the pad draws it: −1…1 each way, 0 inside the dead zone.
    public var aim: (x: Double, y: Double) { (thumbShape(ax), thumbShape(ay)) }
    /// Whether the last tick could aim (held, in the air, roof up, high enough, the row allowing; 0164: not while an
    /// inward slide waits for the semi to pass).
    public var aimLive: Bool { live }
    /// 0164: how far roof up the sight shows (the up axis's y above this): a hold that has slid keeps aiming past 0.94.
    public var aimUy: Double { slid ? AIM_UY_SLID : 0.94 }

    /// Fill `out` (cleared: clearInput) for this tick. `steer`: an extra steer (tilt), driver-relative.
    @discardableResult public func sample(_ run: Run, _ released: Bool, _ out: Input, _ steer: Double = 0) -> Input {
        let c = run.car, stage = thumbStage(run, released)
        let v = DMath.dhypot(c.vel.x, c.vel.y, c.vel.z)
        let press = pressed; pressed = false
        if press { airPress = stage == .fly }   // 0177: this hold was pressed in the air
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
            // 0165: the brake has turned the fall (the sink 0.5 m/s past its peak).
            let sink = -c.vel.y
            if sink > pk { pk = sink } else if pk > 4 && sink < pk - 0.5 { braked = true }
            canA_ = run.course != "show" || canA_ || (braked && (rowBehind(run, c) || (!overRoof(c) && shortRoom(c, c.pos.y - SPEC.comHeight))))
            if held_ {
                M3.rotate(tUw, c.quat, M3.set(tUw, 0, 1, 0))
                let h = c.pos.y - SPEC.comHeight
                let k = jsMax(0, jsMin(1, (h - THUMB.aimFloor) / THUMB.aimFade))
                if !(tUw.y > (slid ? AIM_UY_SLID : 0.94) && k > 0) && !slid { ref0 = .nan; steady = 0 }
                else if tUw.y > (slid ? AIM_UY_SLID : 0.94) && k > 0 {
                    let clear = rowBehind(run, c)
                    // 0164: sideways is a place, flown by LAND's hold-the-line law (src/onethumb.js says why).
                    M3.rotate(tFw, c.quat, M3.set(tFw, 0, 0, 1))
                    predict(c, jsMax(0, h), pr, land: landing_)
                    M3.rotate(tBx, c.quat, M3.set(tBx, 1, 0, 0))
                    let bs = sideOf(tBx.x, tBx.z, tFw)
                    let vb = c.vel.x * tBx.x + c.vel.y * tBx.y + c.vel.z * tBx.z
                    let tGo = jsMax(AIM_TGO, pr.tLand), lead = tGo / (1 + tGo / (2 * HOLD_TAU))
                    let here = sideOf(c.pos.x, c.pos.z, tFw)
                    var roll = 0.0
                    wait = false
                    let sx = thumbShape(ax)
                    let quick = airPress && run.course == "wall"   // 0177
                    if !slid || ref_ != ref_ {
                        ref_ = here + (quick ? vb - (1 - REF_LEAK) * c.vel.y * tBx.y : vb) * bs * lead
                        if ref0 != ref0 { ref0 = ref_; win = 0 }
                        else {
                            win += 1
                            if win >= REF_WIN {
                                steady = abs(ref_ - ref0) * (240.0 / Double(REF_WIN)) < REF_STEADY ? steady + 1 : 0
                                ref0 = ref_; win = 0
                            }
                        }
                    }
                    if sx != 0 || slid {
                        let pad = (COURSES[run.course] ?? SHOW).pad ?? SHOW.pad!, ps = sideOf(pad.x, pad.z, tFw)
                        let off = sx == 0 ? 0 : (jsMax(-1, jsMin(1, ax)) * THUMB.aimPx) / AIM_PX_PER_M
                        let want = off >= 0 ? jsMax(ref_, jsMin(ref_ + off, ps + AIM_RING)) : jsMin(ref_, jsMax(ref_ + off, ps - AIM_RING))
                        let inward = (want - ref_) * sideOf(c.pos.x, 0, tFw) < 0
                        let w = run.course == "show" && inward && tallAhead(c)
                        let settling = !slid && !quick && steady < REF_WINS
                        if w { wait = true } else if sx != 0 && !settling { slid = true }
                        if slid && (want != ref_ || sx == 0) && !w && !settling {
                            let vNeed = ((want - here) / lead) * bs
                            let bMax = AIM_BANK * jsMax(AIM_LOW, jsMin(1, (h - THUMB.aimFloor) / AIM_LOW_H))
                            var bank = jsMax(-bMax, jsMin(bMax, HOLD_K * AIM_GAIN * (vb - vNeed)))
                            if quick && sx != 0 {   // 0177: never less than LAND's own hold, the way slid
                                let hold = jsMax(-HOLD_BANK, jsMin(HOLD_BANK, HOLD_K * vb))
                                bank = (want - ref_) * bs > 0 ? jsMin(bank, hold) : jsMax(bank, hold)
                            }
                            roll = k * HOLD_ROLL * bank
                            if abs(roll) < 0.05 { roll = 0 }
                        }
                    }
                    if roll != 0 && run.course == "show" && !clear {
                        if flankAhead(c, roll * -tFw.z * AIM_ACC + 9.81 * tUw.x) { roll = 0 }
                    }
                    // 0165: along the run, a place on the Show (the Wall: the slide is the pitch, as 0121).
                    var pitch = 0.0
                    if run.course != "show" {
                        if clear { pitch = k * THUMB.aimPitch * thumbShape(ay) }
                    } else if canA_ {
                        let predA = pr.landX * tFw.x + pr.landZ * tFw.z
                        if !slidA || refA_ != refA_ { refA_ = predA }
                        let sy = thumbShape(ay)
                        if sy != 0 { slidA = true }
                        if slidA {
                            let spad = SHOW.pad!, pa = spad.x * tFw.x + spad.z * tFw.z
                            let off = sy == 0 ? 0 : (jsMax(-1, jsMin(1, ay)) * THUMB.aimPx) / AIM_PX_PER_M
                            var want = off >= 0 ? jsMax(refA_, jsMin(refA_ + off, pa + AIM_RING)) : jsMin(refA_, jsMax(refA_ + off, pa - AIM_RING))
                            want = jsMax(want, jsMin(refA_, SHOW_END * tFw.z))
                            let err = want - predA, tGo = jsMax(AIM_TGO, pr.tLand)
                            pitch = jsMax(-THUMB.aimPitch, jsMin(THUMB.aimPitch, (2 * err) / (tGo * tGo * PITCH_ACC)))
                            pitch *= jsMax(0, jsMin(1, (h - PITCH_FLOOR) / THUMB.aimFade))
                            if abs(pitch) < 0.02 { pitch = 0 }
                        }
                    }
                    out.pitch = pitch
                    live = !wait
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
/// 0164: `ref` (the thumb's `ref`, NaN for none): the mark laid out sideways from where the slide measures from.
/// 0165: along the run from `refA` (NaN: from `pr`), drawn only while the slide can act (`canA`). `m` stays the whole miss.
public func markOffset(_ c: Vehicle, _ pr: Prediction, _ course: String, _ ref: Double = .nan, _ refA: Double = .nan, _ canA: Bool = true) -> (x: Double, y: Double, m: Double) {
    let pad = (COURSES[course] ?? SHOW).pad ?? SHOW.pad!
    M3.rotate(mFw, c.quat, M3.set(mFw, 0, 0, 1))
    let ez = pad.z - pr.landZ, ex = pad.x - pr.landX
    let along = refA == refA ? pad.z * mFw.z + pad.x * mFw.x - refA : ez * mFw.z + ex * mFw.x, side = ref == ref ? sideOf(pad.x, pad.z, mFw) - ref : ez * mFw.x - ex * mFw.z
    var x = side * AIM_PX_PER_M, y = canA ? -along * AIM_PX_PER_M : 0
    let d = DMath.dhypot(x, y, 0)
    if d > AIM_R { x *= AIM_R / d; y *= AIM_R / d }
    return (x, y, DMath.dhypot(side, along, 0))
}
#endif
