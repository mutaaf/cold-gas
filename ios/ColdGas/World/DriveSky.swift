// Free Drive's time of day (0228): where the sun is, and what that does to the light. The sun runs a real path over a
// latitude of 46° (an alpine pass) a few weeks either side of an equinox (declination +10°); north is +z, east +x. The key
// light is the sun's illuminance through the air (SkyCPU.transmittance, the same air the sky is drawn with), the exposure is
// set from it so a frame reads at any hour, and the stars and the headlamps come on as the sun goes down.
// The player picks a time (the drive's sun button cycles golden hour → sunset → blue hour → night → morning → midday) or
// lets the day run (`cycle`: a game hour every 30 s). `-fd-tod <hour>` sets it for shots; `-fd-tod classic` is 0226's
// painted blue hour (the physical sky off).
import Foundation
import simd

final class DriveSky {
    enum Preset: String, CaseIterable {
        case golden, sunset, blue, night, morning, midday, cycle, classic
        var hour: Double {
            switch self {
            case .golden: return 18.2
            case .sunset: return 18.62
            case .blue: return 19.25
            case .night: return 22.5
            case .morning: return 6.6
            case .midday: return 12.6
            case .cycle: return 18.2
            case .classic: return 19.25
            }
        }
        var label: String {
            switch self {
            case .golden: return "Golden hour"
            case .sunset: return "Sunset"
            case .blue: return "Blue hour"
            case .night: return "Night"
            case .morning: return "Morning"
            case .midday: return "Midday"
            case .cycle: return "The day runs"
            case .classic: return "Painted dusk"
            }
        }
        /// The button's SF Symbol.
        var icon: String {
            switch self {
            case .golden, .sunset: return "sun.horizon"
            case .blue: return "sun.haze"
            case .night, .classic: return "moon.stars"
            case .morning: return "sunrise"
            case .midday: return "sun.max"
            case .cycle: return "clock.arrow.circlepath"
            }
        }
    }
    static let order: [Preset] = [.golden, .sunset, .blue, .night, .morning, .midday, .cycle]

    private(set) var preset: Preset
    /// The hour (0 ..< 24, local solar time).
    private(set) var hour: Double
    /// Game hours a real second while the day runs.
    static let cycleRate = 1.0 / 30
    static let latitude = 46.0 * Double.pi / 180, declination = 10.0 * Double.pi / 180

    // What the hour gives (updated by `advance`).
    private(set) var sun = SIMD3<Float>(0, 1, 0)
    private(set) var keyColor = SIMD3<Float>(1, 1, 1), keyIntensity: Float = 1, exposure: Float = 1
    /// 0 by day … 1 at night: the stars, the headlamps' need.
    private(set) var night: Float = 0
    /// The physical sky is on (everything but `classic`).
    var physical: Bool { preset != .classic }
    private var lastHour = -1.0

    private static let saved = "coldgas.drive.sky"
    init() {
        // The player's last choice, unless a shot asks for an hour.
        var p = Preset(rawValue: UserDefaults.standard.string(forKey: DriveSky.saved) ?? "") ?? .golden
        if let a = Launch.value("-fd-tod") {
            if let pr = Preset(rawValue: a) { p = pr } else if let h = Double(a) { p = .golden; preset = p; hour = h; update(); return }
        }
        preset = p; hour = p.hour
        update()
    }

    /// The next preset (the sun button).
    func cycle() {
        let i = DriveSky.order.firstIndex(of: preset) ?? -1
        set(DriveSky.order[(i + 1) % DriveSky.order.count])
    }
    func set(_ p: Preset) {
        preset = p; if p != .cycle { hour = p.hour }; update()
        if Launch.value("-fd-tod") == nil { UserDefaults.standard.set(p.rawValue, forKey: DriveSky.saved) }
    }

    func advance(_ dt: Double) {
        guard preset == .cycle else { return }
        hour = (hour + dt * DriveSky.cycleRate).truncatingRemainder(dividingBy: 24)
        if abs(hour - lastHour) > 0.002 { update() }
    }

    /// The sun's direction at an hour.
    static func sunDir(hour: Double) -> SIMD3<Double> {
        let H = (hour - 12) * 15 * Double.pi / 180, phi = latitude, d = declination
        let se = sin(phi) * sin(d) + cos(phi) * cos(d) * cos(H)
        let e = asin(max(-1, min(1, se)))
        let A = atan2(-sin(H), tan(d) * cos(phi) - sin(phi) * cos(H))
        return SIMD3(sin(A) * cos(e), sin(e), cos(A) * cos(e))
    }

    private func update() {
        lastHour = hour
        let s = DriveSky.sunDir(hour: hour)
        sun = SIMD3<Float>(s)
        // The sun at the eye's usual height (a few hundred metres up a pass): its colour and strength through the air.
        let T = SkyCPU.transmittance(heightKm: 0.4, sunY: s.y)
        let e = SIMD3<Float>(T * SkyCPU.sunE)
        let peak = max(e.x, max(e.y, e.z))
        keyColor = peak > 1e-5 ? e / peak : SIMD3(1, 0.6, 0.4)
        keyIntensity = peak
        // The exposure: a frame's light is the sun on the ground plus the sky's (≈ 15 % of a high sun's, more of a low one's
        // and all of it after sunset), and a night floor so the road still reads under the lamps.
        let lum = Double(simd_dot(e, SIMD3<Float>(0.2126, 0.7152, 0.0722)))
        let sky = SkyCPU.sunE * 0.16 * smoothstepD(-0.2, 0.35, s.y)
        let total = lum * max(0, s.y) + sky
        exposure = Float(min(14, max(0.85, 1.75 / pow(total + 0.012, 0.82))))
        night = Float(1 - smoothstepD(-0.16, 0.02, s.y))
    }
}

func smoothstepD(_ a: Double, _ b: Double, _ x: Double) -> Double { let t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
