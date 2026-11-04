// src/sim/m3.js, line for line. JS passes {x,y,z} objects by reference and mutates them through `out`
// arguments (and code relies on that aliasing), so V3/Q4 are final classes, made once, never per tick.
public final class V3 {
    public var x: Double, y: Double, z: Double
    public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0) { self.x = x; self.y = y; self.z = z }
}
public final class Q4 {
    public var x: Double, y: Double, z: Double, w: Double
    public init(_ x: Double = 0, _ y: Double = 0, _ z: Double = 0, _ w: Double = 1) { self.x = x; self.y = y; self.z = z; self.w = w }
}
public enum M3 {
    @inline(__always) @discardableResult public static func set(_ o: V3, _ x: Double, _ y: Double, _ z: Double) -> V3 { o.x = x; o.y = y; o.z = z; return o }
    @inline(__always) @discardableResult public static func copy(_ o: V3, _ a: V3) -> V3 { o.x = a.x; o.y = a.y; o.z = a.z; return o }
    @inline(__always) @discardableResult public static func add(_ o: V3, _ a: V3, _ b: V3) -> V3 { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o }
    @inline(__always) @discardableResult public static func sub(_ o: V3, _ a: V3, _ b: V3) -> V3 { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o }
    @inline(__always) @discardableResult public static func scale(_ o: V3, _ a: V3, _ s: Double) -> V3 { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o }
    @inline(__always) @discardableResult public static func addScaled(_ o: V3, _ a: V3, _ b: V3, _ s: Double) -> V3 { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o }
    @inline(__always) public static func dot(_ a: V3, _ b: V3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
    @inline(__always) public static func len(_ a: V3) -> Double { jsSqrt(a.x * a.x + a.y * a.y + a.z * a.z) }
    @inline(__always) @discardableResult public static func cross(_ o: V3, _ a: V3, _ b: V3) -> V3 {
        let x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x
        o.x = x; o.y = y; o.z = z; return o
    }
    @inline(__always) @discardableResult public static func normalize(_ o: V3, _ a: V3) -> V3 {
        let l = jsOr(len(a), 1)
        o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o
    }
    /// Rotate v by unit quaternion q (body → world).
    @inline(__always) @discardableResult public static func rotate(_ o: V3, _ q: Q4, _ v: V3) -> V3 {
        let qx = q.x, qy = q.y, qz = q.z, qw = q.w
        let tx = 2 * (qy * v.z - qz * v.y), ty = 2 * (qz * v.x - qx * v.z), tz = 2 * (qx * v.y - qy * v.x)
        let x = v.x + qw * tx + (qy * tz - qz * ty)
        let y = v.y + qw * ty + (qz * tx - qx * tz)
        let z = v.z + qw * tz + (qx * ty - qy * tx)
        o.x = x; o.y = y; o.z = z; return o
    }
    /// Rotate by the conjugate (world → body).
    @inline(__always) @discardableResult public static func rotateInv(_ o: V3, _ q: Q4, _ v: V3) -> V3 {
        let qx = q.x, qy = q.y, qz = q.z, qw = q.w
        let tx = 2 * (-qy * v.z + qz * v.y), ty = 2 * (-qz * v.x + qx * v.z), tz = 2 * (-qx * v.y + qy * v.x)
        let x = v.x + qw * tx + (-qy * tz + qz * ty)
        let y = v.y + qw * ty + (-qz * tx + qx * tz)
        let z = v.z + qw * tz + (-qx * ty + qy * tx)
        o.x = x; o.y = y; o.z = z; return o
    }
    /// q += 0.5 · (0, w) · q · dt (w in the world frame), then renormalise.
    @inline(__always) @discardableResult public static func integrateQuat(_ q: Q4, _ w: V3, _ dt: Double) -> Q4 {
        let hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5
        let x = q.x, y = q.y, z = q.z, qw = q.w
        q.x = x + hx * qw + hy * z - hz * y
        q.y = y + hy * qw + hz * x - hx * z
        q.z = z + hz * qw + hx * y - hy * x
        q.w = qw - hx * x - hy * y - hz * z
        let l = jsOr(jsSqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w), 1)
        q.x /= l; q.y /= l; q.z /= l; q.w /= l
        return q
    }
    @inline(__always) @discardableResult public static func quatFromYaw(_ q: Q4, _ yaw: Double) -> Q4 {
        q.x = 0; q.y = DMath.dsin(yaw / 2); q.z = 0; q.w = DMath.dcos(yaw / 2); return q
    }
    @inline(__always) public static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { v < lo ? lo : v > hi ? hi : v }
}
