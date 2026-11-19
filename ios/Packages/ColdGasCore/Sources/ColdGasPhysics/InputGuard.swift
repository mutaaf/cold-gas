// A drive's input, held finite before it reaches the engine (0301; docs/AUDIT-2026-11-18.md "Hardened"). Free Drive and the
// roams read the hands, the tilt, a pad and the autopilot every tick; a value that isn't a number (a sensor's NaN, a pad's
// garbage) would ride into the chassis and the engine before the 0229 watchdog caught the car's state afterwards. Here it
// never gets in: a non-finite field is 0, as if that control were let go. A finite input is left exactly as it was, so a
// drive that never sees one is unchanged to the bit. The scored run never calls this: its inputs are its log of integers.
import Foundation

/// Makes every field of `i` finite (a non-finite one becomes 0). Returns how many it repaired (0: untouched).
@discardableResult
public func guardInput(_ i: Input) -> Int {
    var n = fin(&i.throttle) + fin(&i.brake) + fin(&i.steer) + fin(&i.pitch) + fin(&i.roll) + fin(&i.yaw) + fin(&i.lift)
    n += fin(&i.thrust) + fin(&i.retro) + fin(&i.level) + fin(&i.fan) + fin(&i.assist) + fin(&i.manual)
    for k in 0..<i.v.count where !i.v[k].isFinite { i.v[k] = 0; n += 1 }
    return n
}
@inline(__always) private func fin(_ x: inout Double) -> Int { if x.isFinite { return 0 }; x = 0; return 1 }
