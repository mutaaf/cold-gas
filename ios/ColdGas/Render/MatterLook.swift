// What matter does to the car as the renderer draws it (0332, 0333; docs/NATIVE-MATTER.md): the coat (CarMatter.h's
// Frame.matter, from ColdGasPhysics CarDirt and the WATER track's wetness) and a bent arm's toe and camber. Pure helpers:
// nothing here allocates or keeps state.
import simd
import ColdGasCore

enum MatterLook {
    /// Frame.matter for the car at `carPos` (its CoM, render space) turned by `carQuat`.
    static func frame(_ l: DriveCarLook, carPos: SIMD3<Float>, carQuat q: simd_quatf) -> (SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>) {
        let up = q.act(SIMD3<Float>(0, 1, 0)), fw = q.act(SIMD3<Float>(0, 0, 1))
        let ground = carPos - up * Float(SPEC.comHeight)
        func f(_ x: Float) -> Float { x.isFinite ? min(1, max(0, x)) : 0 }
        return (SIMD4(ground, 1), SIMD4(up, f(l.wet)), SIMD4(fw, f(l.snow)),
                SIMD4(l.coat.x, l.coat.y, l.coat.z, f(l.coat.w)), SIMD4(f(l.dirt.x), f(l.dirt.y), f(l.dirt.z), f(l.dirt.w)),
                SIMD4(Float(AXLE_F), Float(AXLE_R), Float(SPEC.trackFront / 2), 0))
    }
    /// A wheel's pivot turned by its toe (about up) and leaned by its camber (its top toward the car's middle when negative).
    static func bent(toe: Float, camber: Float, left: Bool) -> simd_float4x4 {
        let t = toe.isFinite ? toe : 0, c = camber.isFinite ? camber : 0
        if t == 0 && c == 0 { return matrix_identity_float4x4 }
        return simd_float4x4(simd_quatf(angle: t, axis: [0, 1, 0])) * rotZ(left ? -c : c)
    }
}
