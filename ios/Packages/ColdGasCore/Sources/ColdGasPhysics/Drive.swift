// Free Drive's world near the car, for the engine (docs/NATIVE-FREEDRIVE.md §5): what src/sim/world.js streamFree does
// for the web's roads, done for the lattice world. Unscored: nothing here runs on a scored course (World.streamer is nil
// there), and nothing a drive does reaches a score.
//   - The ground in 16 m cells, as trimeshes of the exact ground (ColdGasWorld's carved land) on 2 m posts, split by
//     what's underfoot: asphalt, the gravel shoulder, the land (its material by biome and slope). Within ±WIN cells of
//     the car; the 3 × 3 round it built at once if they're missing, the rest built off the main thread and added two a
//     tick, nearest first.
//   - Tree trunks and boulders as solids (cylinders and balls) in the 128 m prop cells round the car.
//   - The origin (World.ox/oz) floats: 0 within NEAR of the centre (where the stage's own colliders are, the floor, the
//     Wall, the steel, the launch site, all built at 0), else the car's position snapped to a cell, moved when the car is
//     REBASE metres off it. A move takes the stage's colliders out (they're kilometres away), puts the parked bodies and
//     the car where they were, and rebuilds the cells round the car: the engine never sees a coordinate past ≈ 600 m.
#if canImport(CRapier)
import Foundation
import CRapier
import ColdGasCore
import ColdGasWorld

/// What streams things into a world near the car, once a tick before the car's forces (World.preStep).
public protocol WorldStreamer: AnyObject { func tick(_ w: World) }

public final class DriveStreamer: WorldStreamer {
    public static let cell = 16.0, posts = 8, win = 3, rebase = 512.0, near = 2200.0
    public let world: FreeWorld
    /// One cell's ground, built off the main thread: vertices relative to its corner, three index lists.
    struct CellData { let ix: Int, iz: Int; let v: [Float]; let asphalt: [UInt32], gravel: [UInt32], land: [UInt32]; let mat: Material; let lo: Double, hi: Double }
    private struct Built { var cols: [UInt64]; let solid: Solid }
    private var cells: [Int64: Built] = [:]
    private var data: [Int64: CellData] = [:]
    private var props: [Int64: Built] = [:]
    private var propData: [Int64: [PropSolid]] = [:]
    private var asked = Set<Int64>(), propAsked = Set<Int64>()
    private var done: [CellData] = [], propDone: [(Int64, [PropSolid])] = []
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "coldgas.drive.cells", qos: .userInitiated, attributes: .concurrent)
    private var at = (Int.min, Int.min)
    public private(set) var rebases = 0
    public init(world: FreeWorld) { self.world = world }

    @inline(__always) static func key(_ i: Int, _ j: Int) -> Int64 { (Int64(Int32(truncatingIfNeeded: i)) << 32) | Int64(UInt32(bitPattern: Int32(truncatingIfNeeded: j))) }

    /// Aero downforce for the drive's car (0224): ½ρ·ClA·v² along the car's own down. ClA 0.35 m² is an ESTIMATE for a
    /// low two-seat roadster with a rear wing (road sports cars measure ≈ 0.1–0.6 m²; race cars several m²): about 340 N
    /// at 40 m/s, 2 % of its weight, enough to steady a fast sweeper and no more. Drive only: scored courses have no
    /// streamer, so their forces are untouched (the run vectors prove it).
    public static let clA = 0.35, rho = 1.225
    public var aero = true
    @inline(__always) public static func downforce(_ v: Double) -> Double { 0.5 * rho * clA * v * v }

    public func tick(_ w: World) {
        guard let p = w.carPos else { return }
        origin(w, p.x, p.z)
        if aero, let v = w.carVel, let q = w.carQuat {
            let f = DriveStreamer.downforce((v.x * v.x + v.y * v.y + v.z * v.z).squareRoot())
            // The car's up, from its rotation: −f along it.
            let ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.y * q.z + q.w * q.x)
            w.carF.x -= f * ux; w.carF.y -= f * uy; w.carF.z -= f * uz
        }
        let C = DriveStreamer.cell, ix = Int((p.x / C).rounded(.down)), iz = Int((p.z / C).rounded(.down))
        lock.lock(); let fresh = done; done.removeAll(); let freshProps = propDone; propDone.removeAll(); lock.unlock()
        for d in fresh { data[DriveStreamer.key(d.ix, d.iz)] = d }
        for (k, s) in freshProps { propData[k] = s }
        let W = DriveStreamer.win
        if (ix, iz) != at {
            at = (ix, iz)
            for (k, c) in cells where cheb(k, ix, iz) > W + 1 { drop(w, c); cells[k] = nil }
            for k in data.keys where cheb(k, ix, iz) > W + 4 { data[k] = nil; asked.remove(k) }
        }
        // The cells round the car: now.
        for j in (iz - 1)...(iz + 1) { for i in (ix - 1)...(ix + 1) {
            let k = DriveStreamer.key(i, j)
            if cells[k] != nil || onFloor(w, i, j) { continue }
            let d = data[k] ?? DriveStreamer.build(world, i, j)
            data[k] = d
            cells[k] = add(w, d)
        } }
        // The rest of the window: what's been built, two a tick, nearest first; ask for what hasn't.
        var added = 0
        for r in 2...W { for j in (iz - r)...(iz + r) { for i in (ix - r)...(ix + r) where max(abs(i - ix), abs(j - iz)) == r {
            let k = DriveStreamer.key(i, j)
            if cells[k] != nil || onFloor(w, i, j) { continue }
            if let d = data[k] { if added < 2 { cells[k] = add(w, d); added += 1 } }
            else if !asked.contains(k) {
                asked.insert(k)
                let wd = world
                queue.async { [weak self] in
                    let d = DriveStreamer.build(wd, i, j)
                    guard let self else { return }
                    self.lock.lock(); self.done.append(d); self.lock.unlock()
                }
            }
        } } }
        // Trunks and boulders in the prop cells round the car.
        let P = PropSpec.cell, pi = Int((p.x / P).rounded(.down)), pj = Int((p.z / P).rounded(.down))
        for (k, c) in props where cheb(k, pi, pj) > 2 { drop(w, c); props[k] = nil }
        for k in propData.keys where cheb(k, pi, pj) > 4 { propData[k] = nil; propAsked.remove(k) }
        for j in (pj - 1)...(pj + 1) { for i in (pi - 1)...(pi + 1) {
            let k = DriveStreamer.key(i, j)
            if props[k] != nil { continue }
            if let s = propData[k] { props[k] = addProps(w, s); continue }
            if propAsked.contains(k) { continue }
            propAsked.insert(k)
            let wd = world
            queue.async { [weak self] in
                let s = wd.props(i, j).solids
                guard let self else { return }
                self.lock.lock(); self.propDone.append((k, s)); self.lock.unlock()
            }
        } }
    }

    @inline(__always) private func cheb(_ k: Int64, _ i: Int, _ j: Int) -> Int {
        let ki = Int(Int32(truncatingIfNeeded: k >> 32)), kj = Int(Int32(truncatingIfNeeded: k))
        return max(abs(ki - i), abs(kj - j))
    }
    /// Wholly on the stage's floor while the floor is there (the floor collider is the ground).
    private func onFloor(_ w: World, _ i: Int, _ j: Int) -> Bool {
        if w.centre.isEmpty { return false }
        let C = DriveStreamer.cell, x0 = Double(i) * C, z0 = Double(j) * C
        return abs(x0) < ColdGasWorld.Site.half && abs(x0 + C) < ColdGasWorld.Site.half && abs(z0) < ColdGasWorld.Site.half && abs(z0 + C) < ColdGasWorld.Site.half
    }

    // MARK: - Building

    static func material(_ s: Surface) -> Material {
        switch s {
        case .concrete: return MATERIALS.concrete
        case .asphalt: return MATERIALS.asphalt
        case .gravel: return MATERIALS.gravel
        case .grass: return MATERIALS.grass
        case .dirt: return MATERIALS.dirt
        case .rock: return MATERIALS.rock
        case .sand, .water: return MATERIALS.sand
        case .snow: return MATERIALS.gravel
        }
    }
    /// One cell's ground (pure: any thread).
    static func build(_ world: FreeWorld, _ ix: Int, _ iz: Int) -> CellData {
        let C = cell, N = posts, step = C / Double(N), x0 = Double(ix) * C, z0 = Double(iz) * C
        let q = world.roads.query(minX: x0, minZ: z0, maxX: x0 + C, maxZ: z0 + C)
        var v = [Float](repeating: 0, count: (N + 1) * (N + 1) * 3)
        var surf = [Surface](repeating: .grass, count: (N + 1) * (N + 1))
        var lo = Double.infinity, hi = -Double.infinity
        var mid = GroundPoint()
        for j in 0...N { for i in 0...N {
            let g = world.ground(x0 + Double(i) * step, z0 + Double(j) * step, q)
            let k = j * (N + 1) + i
            v[k * 3] = Float(Double(i) * step); v[k * 3 + 1] = Float(g.y); v[k * 3 + 2] = Float(Double(j) * step)
            surf[k] = g.surface
            lo = min(lo, g.y); hi = max(hi, g.y)
            if i == N / 2 && j == N / 2 { mid = g }
        } }
        // The land's material: the cell's middle, by its slope across the cell.
        let a = Double(v[1]), b = Double(v[N * 3 + 1]), c = Double(v[(N * (N + 1)) * 3 + 1])
        let sx = (b - a) / C, sz = (c - a) / C, slope = 1 - 1 / (sx * sx + 1 + sz * sz).squareRoot()
        var gm = mid; gm.surface = .grass
        let mat = material(FreeWorld.surface(gm, slope: slope))
        var asphalt: [UInt32] = [], gravel: [UInt32] = [], land: [UInt32] = []
        func road(_ s: Surface) -> Int { s == .asphalt || s == .concrete ? 2 : s == .gravel ? 1 : 0 }
        for j in 0..<N { for i in 0..<N {
            let A = j * (N + 1) + i, B = A + 1, Cc = A + N + 1, D = Cc + 1
            // The split the renderer makes: (0,0)–(1,1).
            for t in [(A, D, B), (A, Cc, D)] {
                let r = road(surf[t.0]) + road(surf[t.1]) + road(surf[t.2])
                let tri = [UInt32(t.0), UInt32(t.1), UInt32(t.2)]
                if r >= 5 { asphalt += tri } else if r >= 2 { gravel += tri } else { land += tri }
            }
        } }
        return CellData(ix: ix, iz: iz, v: v, asphalt: asphalt, gravel: gravel, land: land, mat: mat, lo: lo, hi: hi)
    }
    private func add(_ w: World, _ d: CellData) -> Built {
        let C = DriveStreamer.cell, x0 = Double(d.ix) * C, z0 = Double(d.iz) * C
        var cols: [UInt64] = []
        for (idx, mat) in [(d.asphalt, MATERIALS.asphalt), (d.gravel, MATERIALS.gravel), (d.land, d.mat)] where !idx.isEmpty {
            let c = colliderFor(w, .trimesh(d.v, idx), DescOpts(t: (x0 - w.ox, 0 - w.oy, z0 - w.oz)), mat, GROUP.staticG)
            if c != CG_NONE { cols.append(c) }
        }
        let s = Solid((x0, d.lo - 0.5, z0, x0 + C, d.hi + 0.5, z0 + C))
        w.solids.append(s)
        return Built(cols: cols, solid: s)
    }
    private func addProps(_ w: World, _ list: [PropSolid]) -> Built {
        var cols: [UInt64] = []
        var b = (Double.infinity, Double.infinity, Double.infinity, -Double.infinity, -Double.infinity, -Double.infinity)
        for s in list {
            let c: UInt64
            switch s.kind {
            case .trunk:
                c = colliderFor(w, .cylinder(s.h / 2, s.r), DescOpts(t: (s.x - w.ox, s.y + s.h / 2 - w.oy, s.z - w.oz)), MATERIALS.wood, GROUP.staticG)
                b = (min(b.0, s.x - s.r), min(b.1, s.y), min(b.2, s.z - s.r), max(b.3, s.x + s.r), max(b.4, s.y + s.h), max(b.5, s.z + s.r))
            case .boulder:
                c = colliderFor(w, .ball(s.r), DescOpts(t: (s.x - w.ox, s.y - w.oy, s.z - w.oz)), MATERIALS.rock, GROUP.staticG)
                b = (min(b.0, s.x - s.r), min(b.1, s.y - s.r), min(b.2, s.z - s.r), max(b.3, s.x + s.r), max(b.4, s.y + s.r), max(b.5, s.z + s.r))
            }
            if c != CG_NONE { cols.append(c) }
        }
        let s = Solid(list.isEmpty ? (0, 0, 0, 0, 0, 0) : b)
        if !list.isEmpty { w.solids.append(s) }
        return Built(cols: cols, solid: s)
    }
    private func drop(_ w: World, _ b: Built) {
        for c in b.cols { w.info[c] = nil; cg_world_remove_collider(w.rw, c, false) }
        if let i = w.solids.firstIndex(where: { $0 === b.solid }) { w.solids.remove(at: i) }
    }

    // MARK: - The floating origin

    private func origin(_ w: World, _ x: Double, _ z: Double) {
        let N = DriveStreamer.near
        var ox = w.ox, oz = w.oz
        if abs(x) < N && abs(z) < N { ox = 0; oz = 0 }
        else if (ox == 0 && oz == 0) || abs(x - ox) > DriveStreamer.rebase || abs(z - oz) > DriveStreamer.rebase {
            ox = (x / DriveStreamer.cell).rounded() * DriveStreamer.cell; oz = (z / DriveStreamer.cell).rounded() * DriveStreamer.cell
        }
        if ox == w.ox && oz == w.oz { return }
        move(w, ox, oz)
    }
    /// Move the engine's origin to (x, 0, z): everything built here is rebuilt there; what moves on its own moves with it.
    public func move(_ w: World, _ x: Double, _ z: Double) {
        let dx = x - w.ox, dz = z - w.oz
        rebases += 1
        for c in cells.values { drop(w, c) }
        cells.removeAll()
        for c in props.values { drop(w, c) }
        props.removeAll()
        w.ox = x; w.oz = z
        var t = [Float](repeating: 0, count: 4)
        for b in w.bodies where b.rb != CG_NONE {
            cg_body_translation(w.rw, b.rb, &t)
            cg_body_set_translation(w.rw, b.rb, t[0] - Float(dx), t[1], t[2] - Float(dz), false)
        }
        for b in w.loose where b.rb != CG_NONE {
            cg_body_translation(w.rw, b.rb, &t)
            cg_body_set_translation(w.rw, b.rb, t[0] - Float(dx), t[1], t[2] - Float(dz), false)
        }
        if w.carRb != CG_NONE, let p = w.carPos { cg_body_set_translation(w.rw, w.carRb, Float(p.x - x), Float(p.y - w.oy), Float(p.z - z), false) }
        // The stage's own colliders live at the centre: out when the origin leaves it, back when it returns.
        if x != 0 || z != 0 {
            for c in w.centre { w.info[c] = nil; cg_world_remove_collider(w.rw, c, false) }
            for s in w.centreSolids { if let i = w.solids.firstIndex(where: { $0 === s }) { w.solids.remove(at: i) } }
            w.centre = []; w.centreSolids = []
        } else if w.centre.isEmpty { buildCentre(w) }
        at = (Int.min, Int.min)
    }
}
#endif
