// The hull's probes for the renderer (crash.js dentHero reads HULL[probe]): read-only, built on first use.
public enum HullProbes {
    public static var count: Int { _ = hullBuilt; return HULL.count }
    public static func probe(_ i: Int) -> (x: Double, y: Double, z: Double)? {
        _ = hullBuilt
        return i >= 0 && i < HULL.count ? (HULL[i].x, HULL[i].y, HULL[i].z) : nil
    }
}
