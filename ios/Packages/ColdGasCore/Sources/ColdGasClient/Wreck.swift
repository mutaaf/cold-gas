// The Wreck score (Wreck Club, operator's call 2026-11-13; 0237, 0239): every run is scored twice, Style (scoreRun's card,
// untouched) and Wreck: how spectacularly it came apart. Never blended.
//
// Pure and deterministic: it reads a list of events the sim already produced (WreckTracker in ColdGasPhysics reads them off
// the run tick by tick: impacts, parked cars shoved or toppled, the car rolling over) and scores them. It never writes the sim,
// so outcomes, replays, the scored card and the 52 vectors are untouched.
//
// Combos come from the physics: events chain while each lands within COMBO_WINDOW of the last, and the chain's multiplier is
// how many different kinds it holds (roof scrape → topple → rollover → crush = ×4). Repeating one kind keeps a chain alive
// but never raises it, so mashing one thing can't farm a combo.
import Foundation
import ColdGasCore

public enum WreckKind: UInt8, CaseIterable, Sendable, Codable {
    case slam, roof, swipe, grind, crush, airborne, rollover, shove, topple
    /// The combo call's word.
    public var name: String {
        switch self {
        case .slam: return "Slam"; case .roof: return "Roof"; case .swipe: return "Side swipe"; case .grind: return "Grind"
        case .crush: return "Crush"; case .airborne: return "Airborne"; case .rollover: return "Rollover"
        case .shove: return "Shove"; case .topple: return "Topple"
        }
    }
}

/// What one event pays, by what happened (`speed` in m/s where it matters). A hit pays like its energy (v²), capped so one
/// slam can't be the score; a scrape is recorded every 33 ms, so each pays little and a long slide can't farm it.
public enum WreckPoints {
    public static func slam(_ v: Double) -> Double { jsMin(60, v * v / 4) }
    public static func roofHit(_ v: Double) -> Double { jsMin(40, v * v / 4) + 5 }
    public static func sideHit(_ v: Double) -> Double { jsMin(40, v * v / 5) }
    public static func scrape(_ v: Double) -> Double { jsMin(2, v / 8) }
    public static let grind = 0.5, crush = 5.0, airborne = 10.0, rollover = 14.0, shove = 15.0, topple = 40.0
}

/// One thing that happened in the wreck, at its tick, and what it paid.
public struct WreckEvent: Equatable, Sendable {
    public var tick: Int, kind: WreckKind, points: Double
    public init(tick: Int, kind: WreckKind, points: Double) { self.tick = tick; self.kind = kind; self.points = points }
}

/// 1.25 s at 240 Hz: the next event must land inside this to keep the chain.
public let COMBO_WINDOW = 300
/// The multiplier tops out here (every kind in one chain).
public let COMBO_MAX = WreckKind.allCases.count
/// raw → 0…100: total = 100 · raw / (raw + WRECK_HALF), so WRECK_HALF raw points is a 50.
public let WRECK_HALF = 400.0

/// A chain of events and what it paid.
public struct WreckCombo: Equatable, Sendable {
    public var startTick: Int, endTick: Int, kinds: [WreckKind], points: Double
    public var multiplier: Int { kinds.count }
    public var paid: Double { points * Double(multiplier) }
}
/// A combo call: the multiplier rose at this tick (the HUD shows it, the phone plays it).
public struct ComboCall: Equatable, Sendable {
    public var tick: Int, multiplier: Int, kind: WreckKind
    public init(tick: Int, multiplier: Int, kind: WreckKind) { self.tick = tick; self.multiplier = multiplier; self.kind = kind }
}

/// The Wreck card: the total out of 100, the categories (0–10), the best chain, the counts, and every combo call in order.
public struct WreckCard: Equatable, Sendable {
    public var total: Double
    public var raw: Double
    public var categories: [(String, Double)]
    public var best: WreckCombo?
    public var calls: [ComboCall]
    public var toppled: Int, shoved: Int, rollovers: Int, hits: Int
    public static func == (a: WreckCard, b: WreckCard) -> Bool {
        a.total == b.total && a.raw == b.raw && a.categories.map(\.0) == b.categories.map(\.0) && a.categories.map(\.1) == b.categories.map(\.1)
            && a.best == b.best && a.calls == b.calls && a.toppled == b.toppled && a.shoved == b.shoved && a.rollovers == b.rollovers && a.hits == b.hits
    }
    public var bestMultiplier: Int { best?.multiplier ?? 0 }
    /// What the crew needs (Crew.swift).
    public var crew: CrewWreck {
        CrewWreck(total: total, bestCombo: bestMultiplier >= 2 ? bestMultiplier : 0, chain: (best?.kinds ?? []).map(\.name), toppled: toppled, shoved: shoved, tumbles: rollovers)
    }
    /// A clean run: nothing to show.
    public var isEmpty: Bool { raw <= 0 }
}

/// The calls a list of events makes, in order: each time a chain's multiplier rises.
public func comboCalls(_ events: [WreckEvent]) -> [ComboCall] {
    var calls: [ComboCall] = []
    var kinds: [WreckKind] = [], last = Int.min
    for e in events {
        if last == Int.min || e.tick - last > COMBO_WINDOW { kinds = [] }
        last = e.tick
        if !kinds.contains(e.kind) {
            kinds.append(e.kind)
            if kinds.count >= 2 { calls.append(ComboCall(tick: e.tick, multiplier: kinds.count, kind: e.kind)) }
        }
    }
    return calls
}

/// Score a wreck's events (ordered by tick, as the tracker records them).
public func wreckCard(_ events: [WreckEvent]) -> WreckCard {
    var chains: [WreckCombo] = []
    var cur: WreckCombo?
    for e in events {
        if var c = cur, e.tick - c.endTick <= COMBO_WINDOW {
            c.endTick = e.tick; c.points += e.points
            if !c.kinds.contains(e.kind) { c.kinds.append(e.kind) }
            cur = c
        } else {
            if let c = cur { chains.append(c) }
            cur = WreckCombo(startTick: e.tick, endTick: e.tick, kinds: [e.kind], points: e.points)
        }
    }
    if let c = cur { chains.append(c) }
    let raw = chains.reduce(0) { $0 + $1.paid }
    // The best chain: the highest multiplier, then the most paid, then the first.
    var best: WreckCombo?
    for c in chains {
        if let b = best, c.multiplier < b.multiplier || (c.multiplier == b.multiplier && c.paid <= b.paid) { continue }
        best = c
    }
    func count(_ k: WreckKind) -> Int { events.reduce(0) { $0 + ($1.kind == k ? 1 : 0) } }
    func pts(_ ks: [WreckKind]) -> Double { events.reduce(0) { $0 + (ks.contains($1.kind) ? $1.points : 0) } }
    func r1(_ v: Double) -> Double { jsRound(v * 10) / 10 }
    func cat(_ p: Double, _ half: Double) -> Double { r1(10 * p / (p + half)) }
    let categories: [(String, Double)] = [
        ("impact", cat(pts([.slam, .roof, .swipe, .grind, .crush]), 60)),
        ("carnage", cat(pts([.shove, .topple]), 40)),
        ("tumble", cat(pts([.rollover, .airborne]), 28)),
        ("combo", r1(Double(best?.multiplier ?? 0) * 10 / Double(COMBO_MAX))),
    ]
    return WreckCard(total: raw > 0 ? r1(100 * raw / (raw + WRECK_HALF)) : 0, raw: r1(raw), categories: categories, best: best,
                     calls: comboCalls(events), toppled: count(.topple), shoved: count(.shove), rollovers: count(.rollover), hits: count(.slam) + count(.roof) + count(.swipe))
}

// --- the combo, felt (0239) -----------------------------------------------------------------------------
/// One transient of a combo call's pattern: when (ms after the call), how hard, how sharp (0…1).
public struct ComboPulse: Equatable, Sendable {
    public var ms: Int, intensity: Float, sharpness: Float
}
/// The pattern a combo call plays: the step's own signature (a swipe rasps, a topple thuds, a rollover tumbles, a crush
/// bites), then one tick per step of the multiplier, each a little harder: a ×4 is felt as four.
public func comboPattern(_ call: ComboCall) -> [ComboPulse] {
    var out: [ComboPulse]
    switch call.kind {
    case .swipe, .grind: out = [ComboPulse(ms: 0, intensity: 0.45, sharpness: 0.95), ComboPulse(ms: 30, intensity: 0.4, sharpness: 0.95), ComboPulse(ms: 60, intensity: 0.35, sharpness: 0.95)]
    case .topple: out = [ComboPulse(ms: 0, intensity: 1, sharpness: 0.15), ComboPulse(ms: 110, intensity: 0.45, sharpness: 0.3)]
    case .rollover: out = [ComboPulse(ms: 0, intensity: 0.7, sharpness: 0.4), ComboPulse(ms: 140, intensity: 0.7, sharpness: 0.4)]
    case .crush: out = [ComboPulse(ms: 0, intensity: 0.95, sharpness: 0.8)]
    case .slam: out = [ComboPulse(ms: 0, intensity: 0.9, sharpness: 0.55)]
    case .roof: out = [ComboPulse(ms: 0, intensity: 0.8, sharpness: 0.7), ComboPulse(ms: 50, intensity: 0.5, sharpness: 0.9)]
    case .airborne: out = [ComboPulse(ms: 0, intensity: 0.3, sharpness: 0.2)]
    case .shove: out = [ComboPulse(ms: 0, intensity: 0.65, sharpness: 0.2)]
    }
    let base = (out.last?.ms ?? 0) + 180
    for k in 0..<Swift.min(call.multiplier, COMBO_MAX) {
        out.append(ComboPulse(ms: base + k * 70, intensity: Swift.min(1, 0.35 + 0.12 * Float(k)), sharpness: 0.75))
    }
    return out
}
