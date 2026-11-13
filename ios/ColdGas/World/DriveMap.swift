// Free Drive's minimap (0226): the roads within half a kilometre, heading-up round the car, the set's slab when it's near,
// in the HUD's hairline glass. Read from the world (ColdGasWorld's lattice roads, pure) six times a second, not per frame.
// Shown or hidden by the map button; the choice is a HUD preference (HudPrefs.driveMap, through HudStore).
import SwiftUI
import ColdGasWorld

final class DriveMap: ObservableObject {
    static let shared = DriveMap()
    static let radius = 520.0
    /// Each road near the car as points in −1…1 (x right, y down: heading-up, the car at the middle).
    @Published private(set) var roads: [[CGPoint]] = []
    /// The set's slab as four corners in the same frame (empty when it's out of range).
    @Published private(set) var slab: [CGPoint] = []
    private var t = 0.0

    /// From the drive's frame: the car at (x, z) heading (fx, fz).
    func update(world: FreeWorld, x: Double, z: Double, fx: Double, fz: Double, dt: Double) {
        t += dt
        guard t > 1.0 / 6 else { return }
        t = 0
        let R = DriveMap.radius, l = max(1e-9, (fx * fx + fz * fz).squareRoot())
        let f = (fx / l, fz / l), rgt = (-f.1, f.0)
        func p(_ wx: Double, _ wz: Double) -> CGPoint {
            let dx = wx - x, dz = wz - z
            return CGPoint(x: (dx * rgt.0 + dz * rgt.1) / R, y: -(dx * f.0 + dz * f.1) / R)
        }
        var out: [[CGPoint]] = []
        for link in world.roads.links(minX: x - R * 1.5, minZ: z - R * 1.5, maxX: x + R * 1.5, maxZ: z + R * 1.5, margin: 0) {
            var line: [CGPoint] = []
            var k = 0
            while k < link.n {
                let q = p(link.x[k], link.z[k])
                if abs(q.x) < 1.6 && abs(q.y) < 1.6 { line.append(q) } else if line.count > 1 { out.append(line); line = [] } else { line = [] }
                k += 3
            }
            if link.n > 0 { let q = p(link.x[link.n - 1], link.z[link.n - 1]); if abs(q.x) < 1.6 && abs(q.y) < 1.6 { line.append(q) } }
            if line.count > 1 { out.append(line) }
        }
        roads = out
        let H = Site.half
        slab = abs(x) < H + R * 1.5 && abs(z) < H + R * 1.5 ? [p(-H, -H), p(H, -H), p(H, H), p(-H, H)] : []
    }
}

struct DriveMapView: View {
    @ObservedObject var map = DriveMap.shared
    var size: CGFloat = 112
    var body: some View {
        Canvas { ctx, sz in
            let c = CGPoint(x: sz.width / 2, y: sz.height / 2), r = sz.width / 2
            func pt(_ q: CGPoint) -> CGPoint { CGPoint(x: c.x + q.x * r, y: c.y + q.y * r) }
            ctx.clip(to: Path(ellipseIn: CGRect(origin: .zero, size: sz)))
            if map.slab.count == 4 {
                var s = Path(); s.move(to: pt(map.slab[0])); for q in map.slab.dropFirst() { s.addLine(to: pt(q)) }; s.closeSubpath()
                ctx.fill(s, with: .color(Theme.ink.opacity(0.08)))
                ctx.stroke(s, with: .color(Theme.ink3), lineWidth: 0.75)
            }
            for line in map.roads {
                var path = Path(); path.move(to: pt(line[0])); for q in line.dropFirst() { path.addLine(to: pt(q)) }
                ctx.stroke(path, with: .color(Theme.ink2), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
            // The car: a chevron at the middle, pointing up (the way it faces).
            var car = Path()
            car.move(to: CGPoint(x: c.x, y: c.y - 6)); car.addLine(to: CGPoint(x: c.x + 4.5, y: c.y + 5)); car.addLine(to: CGPoint(x: c.x, y: c.y + 2.5)); car.addLine(to: CGPoint(x: c.x - 4.5, y: c.y + 5)); car.closeSubpath()
            ctx.fill(car, with: .color(Theme.ink))
        }
        .frame(width: size, height: size)
        .background(Circle().fill(Theme.bg.opacity(0.45)))
        .overlay(Circle().strokeBorder(Theme.ink3.opacity(0.6), lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel("Map: the roads round you, the way you face is up")
    }
}
