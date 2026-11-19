// 0301: a drive's input is held finite before the engine sees it. A non-finite control is let go (0); a finite input is
// left exactly as it was, so a drive that never sees one steps bit for bit as before, and a drive fed NaN keeps a car whose
// state is still a number.
import Foundation
import Testing
@testable import ColdGasPhysics
import ColdGasCore

@Suite(.serialized) struct InputGuardTests {
    @Test func aFiniteInputIsUntouched() {
        let i = Input()
        i.throttle = 0.7; i.brake = 0.1; i.steer = -0.35; i.pitch = 0.2; i.roll = -1; i.yaw = 0.5; i.lift = 1; i.thrust = 0.3
        i.retro = 0.2; i.level = 1; i.fan = 1; i.assist = 1; i.manual = 0
        for k in 0..<10 { i.v[k] = Double(k) / 10 }
        let before = [i.throttle, i.brake, i.steer, i.pitch, i.roll, i.yaw, i.lift, i.thrust, i.retro, i.level, i.fan, i.assist, i.manual] + i.v
        #expect(guardInput(i) == 0)
        let after = [i.throttle, i.brake, i.steer, i.pitch, i.roll, i.yaw, i.lift, i.thrust, i.retro, i.level, i.fan, i.assist, i.manual] + i.v
        #expect(before.map(\.bitPattern) == after.map(\.bitPattern))
    }
    @Test func aNonFiniteControlIsLetGo() {
        let i = Input()
        i.throttle = .nan; i.steer = .infinity; i.brake = -.infinity; i.yaw = 0.4
        i.v[3] = .nan; i.v[9] = .infinity
        #expect(guardInput(i) == 5)
        #expect(i.throttle == 0 && i.steer == 0 && i.brake == 0)
        #expect(i.yaw == 0.4)                 // the good control stays
        #expect(i.v[3] == 0 && i.v[9] == 0)
        #expect(guardInput(i) == 0)           // and it's whole now
    }
    /// The drive's own car, stepped with a NaN steer and throttle every tick for two seconds: guarded, its state stays a
    /// number and it rolls on as if the controls were let go.
    @Test func aDriveFedNaNStaysANumber() throws {
        let c = createVehicle(course: DRIVE_COURSE)
        c.pos.x = -900; c.pos.y = SPEC.comHeight + 0.02; c.pos.z = -1300
        M3.quatFromYaw(c.quat, 0)
        let dm = DriveModel(), inp = Input()
        for t in 0..<480 {
            inp.throttle = t % 2 == 0 ? .nan : 0.5; inp.steer = .infinity; inp.brake = 0
            guardInput(inp)
            try driveStep(c, inp, dm)
        }
        for x in [c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.y, c.vel.z, c.quat.w] { #expect(x.isFinite) }
        #expect((c.vel.x * c.vel.x + c.vel.z * c.vel.z).squareRoot() > 1)   // half the ticks' throttle drove it
        c.world.free()
    }
}
