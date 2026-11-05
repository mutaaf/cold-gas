// src/units.js: what the player reads. The sim is SI; every readout goes through here in both systems, the primary
// first ("87 mph · 140 km/h"), and the judges' prose (written in SI) is rewritten number by number. A value, not the
// web's module state: the app reads the system from its settings and passes it in. Pinned by Tests/Vectors/client.json.
import Foundation
import ColdGasCore

/// The primary system. The raw values are the web's own ('us' is "imperial": mph, ft, lb, psi).
public enum UnitSystem: String, Codable, CaseIterable {
    case us, metric
    public var other: UnitSystem { self == .us ? .metric : .us }
}

public struct Units: Equatable {
    public static let MPS_TO_MPH = 2.2369362920544, MPS_TO_KMH = 3.6
    public static let M_TO_FT = 3.280839895, M_TO_MI = 1 / 1609.344, KG_TO_LB = 2.2046226218
    public static let N_TO_LBF = 0.2248089431, KGF_TO_LBF = 2.2046226218, BAR_TO_PSI = 14.503773773, KW_TO_HP = 1.3410220896

    public enum Quantity: String, CaseIterable { case speed, rate, len, mass, kgf, press, dist, force }
    /// Decimals: one for both systems, or one per system (a length reads whole feet, tenths of a metre).
    public struct Decimals: Equatable {
        public let us: Int, metric: Int
        public init(us: Int, metric: Int) { self.us = us; self.metric = metric }
        public init(_ d: Int) { us = d; metric = d }
        public func of(_ s: UnitSystem) -> Int { s == .us ? us : metric }
    }
    static func table(_ q: Quantity, _ s: UnitSystem) -> (Double, String) {
        switch (q, s) {
        case (.speed, .us): return (MPS_TO_MPH, "mph"); case (.speed, .metric): return (MPS_TO_KMH, "km/h")
        case (.rate, .us): return (M_TO_FT, "ft/s"); case (.rate, .metric): return (1, "m/s")
        case (.len, .us): return (M_TO_FT, "ft"); case (.len, .metric): return (1, "m")
        case (.mass, .us): return (KG_TO_LB, "lb"); case (.mass, .metric): return (1, "kg")
        case (.kgf, .us): return (KGF_TO_LBF, "lbf"); case (.kgf, .metric): return (1, "kgf")
        case (.press, .us): return (BAR_TO_PSI, "psi"); case (.press, .metric): return (1, "bar")
        case (.dist, .us): return (M_TO_MI, "mi"); case (.dist, .metric): return (0.001, "km")
        case (.force, .us): return (N_TO_LBF, "lbf"); case (.force, .metric): return (0.001, "kN")
        }
    }

    public var system: UnitSystem
    public init(_ system: UnitSystem = .us) { self.system = system }

    /// Factor and unit in the primary system (for a live readout), or the secondary with `alt`.
    public func k(_ q: Quantity, alt: Bool = false) -> Double { Units.table(q, alt ? system.other : system).0 }
    public func u(_ q: Quantity, alt: Bool = false) -> String { Units.table(q, alt ? system.other : system).1 }

    static func num(_ n: Double, _ d: Int) -> String { abs(n) >= 1000 && d == 0 ? jsGrouped(jsRound(n)) : jsToFixed(n, d) }
    /// One value in one system: "87 mph".
    public static func one(_ q: Quantity, _ si: Double, _ d: Decimals, _ s: UnitSystem) -> String {
        let (f, unit) = table(q, s)
        return "\(num(si * f, d.of(s))) \(unit)"
    }
    /// One value in the primary system.
    public func one(_ q: Quantity, _ si: Double, _ d: Int = 0) -> String { Units.one(q, si, Decimals(d), system) }
    /// Both, primary first: "87 mph · 140 km/h".
    public func both(_ q: Quantity, _ si: Double, _ d: Decimals = Decimals(0)) -> String {
        "\(Units.one(q, si, d, system)) · \(Units.one(q, si, d, system.other))"
    }
    /// The secondary alone, for a sub-line under a big primary.
    public func alt(_ q: Quantity, _ si: Double, _ d: Decimals = Decimals(0)) -> String { Units.one(q, si, d, system.other) }

    // Formatters: both systems, primary first.
    public func fmtSpeed(_ mps: Double, _ d: Int = 0) -> String { both(.speed, mps, Decimals(d)) }
    public func fmtLen(_ m: Double, _ d: Decimals = Decimals(us: 0, metric: 1)) -> String { both(.len, m, d) }
    public func fmtHeight(_ m: Double, _ d: Decimals = Decimals(us: 0, metric: 1)) -> String { fmtLen(m, d) }
    public func fmtRate(_ mps: Double, _ d: Int = 1) -> String { both(.rate, mps, Decimals(d)) }
    public func fmtDist(_ m: Double, _ d: Int = 1) -> String { both(.dist, m, Decimals(d)) }
    public func fmtMass(_ kg: Double, _ d: Int = 0) -> String { both(.mass, kg, Decimals(d)) }
    public func fmtForce(_ n: Double, _ d: Decimals = Decimals(us: 0, metric: 1)) -> String { both(.force, n, d) }
    public func fmtKgf(_ kgf: Double, _ d: Int = 0) -> String { both(.kgf, kgf, Decimals(d)) }
    public func fmtPressure(_ bar: Double, _ d: Int = 0) -> String { both(.press, bar, Decimals(d)) }
    public func fmtSmall(_ m: Double) -> String {
        let inch = "\(jsToFixed(m * 39.37007874, 1)) in", mm = "\(jsNumberString(jsRound(m * 1000))) mm"
        return system == .us ? "\(inch) · \(mm)" : "\(mm) · \(inch)"
    }
    /// A distance on the road: feet under a tenth of a mile (metres under a kilometre), else mi | km.
    static func road1(_ m: Double, _ s: UnitSystem) -> String {
        if s == .us {
            return m < 160.9344 ? "\(jsNumberString(jsRound(m * M_TO_FT))) ft" : "\(jsToFixed(m * M_TO_MI, m < 16093 ? 2 : 1)) mi"
        }
        return m < 1000 ? "\(jsNumberString(jsRound(m))) m" : "\(jsToFixed(m / 1000, m < 10000 ? 2 : 1)) km"
    }
    public func fmtRoad(_ m: Double) -> String { "\(Units.road1(m, system)) · \(Units.road1(m, system.other))" }
    public func fmtRoad1(_ m: Double, secondary: Bool = false) -> String { Units.road1(m, secondary ? system.other : system) }

    // --- prose: "27.7 m up the wall" → "91 ft (27.7 m) up the wall" -------------------------------------------
    // JS's \w and \d are ASCII and its \s is its own set: spelled out, because ICU's are Unicode-wide.
    static let proseRegex: NSRegularExpression = {
        let space = "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
        let pattern = "(?<![A-Za-z0-9_.,])([+\u{2212}-]?)([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(\\.[0-9]+)?(\(space)?|\u{A0})"
            + "(km/h|m/s\u{B2}|m/s|kgf|kg|kN|kW|km|cm|mm|bar|metres|metre|meters|meter|m)(?![A-Za-z0-9_\u{B2}/])"
        return try! NSRegularExpression(pattern: pattern)
    }()
    static let CONV: [String: (Double, String)] = [
        "km/h": (1 / 1.609344, "mph"), "m/s": (M_TO_FT, "ft/s"), "m/s\u{B2}": (M_TO_FT, "ft/s\u{B2}"), "kg": (KG_TO_LB, "lb"), "kgf": (KGF_TO_LBF, "lbf"),
        "kN": (1000 * N_TO_LBF, "lbf"), "kW": (KW_TO_HP, "hp"), "km": (1 / 1.609344, "mi"), "cm": (1 / 2.54, "in"), "mm": (1 / 25.4, "in"), "bar": (BAR_TO_PSI, "psi"),
        "m": (M_TO_FT, "ft"), "metre": (M_TO_FT, "feet"), "metres": (M_TO_FT, "feet"), "meter": (M_TO_FT, "feet"), "meters": (M_TO_FT, "feet"),
    ]
    static func usOf(_ sign: String, _ int: String, _ frac: String, _ sp: String, _ unit: String) -> String {
        guard let c = CONV[unit], let parsed = Double(int.replacingOccurrences(of: ",", with: "") + frac) else { return sign + int + frac + sp + unit }
        let v = parsed * c.0
        let srcD = frac.isEmpty ? 0 : frac.utf16.count - 1
        var d = srcD
        if unit == "m" || unit.hasPrefix("met") { d = v >= 10 ? 0 : Swift.min(1, srcD + 1) }
        if ["kN", "bar", "kW", "kg", "kgf"].contains(unit) { d = v >= 100 ? 0 : srcD }
        if unit == "km" || unit == "mm" { d = Swift.max(1, srcD) }
        let s = (abs(v) >= 1000 && d == 0) || (int.contains(",") && d == 0) ? jsGrouped(jsRound(v)) : jsToFixed(v, d)
        return "\(sign)\(s)\(sp)\(c.1)"
    }
    static func rewrite(_ text: String, _ f: (_ all: String, _ us: String) -> String) -> String {
        let ns = text as NSString
        let out = NSMutableString()
        var at = 0
        for m in proseRegex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out.append(ns.substring(with: NSRange(location: at, length: m.range.location - at)))
            func g(_ i: Int) -> String { let r = m.range(at: i); return r.location == NSNotFound ? "" : ns.substring(with: r) }
            out.append(f(g(0), usOf(g(1), g(2), g(3), g(4), g(5))))
            at = m.range.location + m.range.length
        }
        out.append(ns.substring(from: at))
        return out as String
    }
    /// Every "<number> <SI unit>" in the text, in US units.
    public static func toUS(_ text: String) -> String { rewrite(text) { _, us in us } }
    /// Both side by side, the primary first: "91 ft (27.7 m) up the wall".
    public func localize(_ text: String) -> String {
        let s = system
        return Units.rewrite(text) { si, us in s == .us ? "\(us) (\(si))" : "\(si) (\(us))" }
    }
}
