// What the tyres are doing, in the hands (0281): a locked wheel's judder, wheelspin's buzz, a slide's grain; in a drive
// also each ABS pulse through the pedal, the handbrake's clack, and a flat spot thumping once a turn. Read from state the
// car already has (each wheel's slip, slip angle, spin, contact; the drive's chassis), never written back: the scored run
// feels its own tyres the same way, and nothing here reaches a score.
import ColdGasCore
import ColdGasPhysics

struct SkidFeel {
    /// 0…1: the worst wheel locked under the brake, spinning under the motor, sliding sideways past its peak.
    var lock = 0.0, spin = 0.0, slide = 0.0

    /// The car's tyres this tick (a scored car or the drive's).
    static func read(_ car: Vehicle) -> SkidFeel {
        var f = SkidFeel()
        let v = (car.vel.x * car.vel.x + car.vel.z * car.vel.z).squareRoot()
        guard v > 1.5 || car.wheels.contains(where: { abs($0.omega) > 8 }) else { return f }
        let atSpeed = min(1, v / 12)
        for w in car.wheels where w.contact {
            if w.slip < -0.3 { f.lock = max(f.lock, min(1, (-w.slip - 0.3) / 0.5 + 0.4) * atSpeed) }
            if w.slip > 0.3 { f.spin = max(f.spin, min(1, (w.slip - 0.3) / 1.5 + 0.3)) }
            let a = abs(w.slipAngle)
            if a > 0.12 { f.slide = max(f.slide, min(1, (a - 0.12) / 0.3) * atSpeed) }
        }
        return f
    }

    /// The continuous channels a run's or a drive's own feel sits over: the larger of each.
    func over(_ c: HapticContinuous) -> HapticContinuous {
        var o = c
        // A locked tyre judders low and blunt; a spinning one buzzes sharper; a slide is a fine grain.
        let rumble = Float(max(lock * 0.55, spin * 0.35))
        if rumble > o.rumble { o.rumble = rumble; o.rumbleSharp = Float(lock >= spin ? 0.12 : 0.55) }
        o.grind = max(o.grind, Float(min(0.45, slide * 0.3 + lock * 0.15)))
        return o
    }
}

/// The drive's own transients (Game.driveFrame, once a frame): ABS's pulses, the handbrake's lever, a flat spot's thump.
@MainActor
final class DriveFeel {
    private var pulses = 0, pulseT = 0.0, lever = false, turn = [Double](repeating: 0, count: 4)

    func reset(_ dm: DriveModel) { pulses = dm.absPulses; pulseT = 0; lever = false; for i in 0..<4 { turn[i] = 0 } }

    func frame(_ fd: FreeDrive, handbrake: Bool, dt: Double) {
        let dm = fd.chassis, car = fd.car
        pulseT += dt
        // ABS: a short, sharp knock for each dump the valves make (the pedal's kick), no more than ≈ 16 a second.
        if dm.absPulses != pulses {
            pulses = dm.absPulses
            if pulseT > 0.06 {
                pulseT = 0
                HapticPlayer.shared.play(HapticEvent(kind: .tap, tick: 0, channel: UInt8(dm.absPulseWheel), intensity: 0.45, sharpness: 0.9))
            }
        }
        // The lever: a heavy clack up, a lighter one down.
        if handbrake != lever {
            lever = handbrake
            HapticPlayer.shared.play(HapticEvent(kind: .hit, tick: 0, channel: 5, intensity: handbrake ? 0.85 : 0.35, sharpness: handbrake ? 0.35 : 0.7))
        }
        // A flat spot: once a turn of the wheel, a thump as the flat comes round (rolling, not sliding).
        for i in 0..<4 where dm.flatSpot[i] > 0.15 && car.wheels[i].contact && !dm.locked[i] {
            turn[i] += abs(car.wheels[i].omega) * dt / (2 * .pi)
            if turn[i] >= 1 {
                turn[i] -= 1
                let v = (car.vel.x * car.vel.x + car.vel.z * car.vel.z).squareRoot()
                if v > 2 && v < 40 { HapticPlayer.shared.play(HapticEvent(kind: .wheel, tick: 0, channel: UInt8(i), intensity: Float(min(0.6, 0.15 + dm.flatSpot[i] * 0.45)), sharpness: 0.3)) }
            }
        }
    }
}
