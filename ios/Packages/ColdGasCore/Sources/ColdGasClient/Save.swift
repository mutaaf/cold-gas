// The save (docs/NATIVE.md §7): initials, medals, the daily streak, settings and the judges' breaker, Codable in one
// UserDefaults value (ios/ColdGas/Model/SaveStore.swift). The rule from moon-club: every field is optional or has a merge
// default, and one bad field never fails the decode, or an old save would reset the player's progress. So nothing here
// uses a synthesised decoder: each field is read with `try?`, and a value it can't read is the default.
import Foundation
import ColdGasCore
import ColdGasLayout

/// src/post.js clean: upper-case, letters A–Z only, at most three.
public func cleanInitials(_ v: String?) -> String {
    let up = (v ?? "").uppercased().unicodeScalars.filter { $0.value >= 65 && $0.value <= 90 }
    return String(String(String.UnicodeScalarView(up)).prefix(3))
}

public enum ControlScheme: String, Codable, CaseIterable { case thumb, classic }   // src/touch-settings.js: one-thumb or classic
public enum Hand: String, Codable, CaseIterable { case right, left }

public struct Settings: Codable, Equatable {
    public var haptics: Bool?, sound: Bool?, scheme: ControlScheme?, hand: Hand?, tilt: Bool?, units: UnitSystem?
    /// 0219: false sends the judges' call to the edge model even where Apple's on-device model could write it.
    public var judgeOnDevice: Bool?
    public init() {}
    enum CodingKeys: String, CodingKey { case haptics, sound, scheme, hand, tilt, units, judgeOnDevice }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        haptics = try? c.decodeIfPresent(Bool.self, forKey: .haptics)
        sound = try? c.decodeIfPresent(Bool.self, forKey: .sound)
        scheme = try? c.decodeIfPresent(ControlScheme.self, forKey: .scheme)
        hand = try? c.decodeIfPresent(Hand.self, forKey: .hand)
        tilt = try? c.decodeIfPresent(Bool.self, forKey: .tilt)
        units = try? c.decodeIfPresent(UnitSystem.self, forKey: .units)
        judgeOnDevice = try? c.decodeIfPresent(Bool.self, forKey: .judgeOnDevice)
    }
    // The defaults, as the web's: haptics and sound on, one thumb, the right hand, no tilt, US units leading; judging on the
    // device where it can.
    public var hapticsOn: Bool { haptics ?? true }
    public var soundOn: Bool { sound ?? true }
    public var controlScheme: ControlScheme { scheme ?? .thumb }
    public var handedness: Hand { hand ?? .right }
    public var tiltOn: Bool { tilt ?? false }
    public var unitSystem: UnitSystem { units ?? .us }
    /// On by default: where the device has Apple Intelligence, the judges write there (0219).
    public var judgeOnDeviceOn: Bool { judgeOnDevice ?? true }
}

public struct SaveData: Codable, Equatable {
    public var initials: String?
    public var medals: [String: Double]?
    public var daily: Daily.Streak?
    public var settings: Settings?
    public var judgeBreaker: BreakerState?
    /// The touch controls the player has shaped (0221): layouts per tier and shape, the stick, the buttons, the look. A save
    /// from before it has none and gets the factory controls; a damaged one costs only what can't be read (HudPrefs).
    public var hud: HudPrefs?
    public init() {}
    enum CodingKeys: String, CodingKey { case initials, medals, daily, settings, judgeBreaker, hud }
    public init(from decoder: Decoder) throws {
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }   // not even an object: a fresh save
        initials = (try? c.decodeIfPresent(String.self, forKey: .initials)).flatMap { $0 }.map { cleanInitials($0) }
        // One junk medal costs that medal, not the rest (the web's load, entry by entry).
        if let raw = try? c.decodeIfPresent([String: JSValue].self, forKey: .medals) {
            medals = Medals(raw.compactMapValues { $0.numberValue }).best
        }
        daily = (try? c.decodeIfPresent(Daily.Streak.self, forKey: .daily)).flatMap { $0 }
        settings = (try? c.decodeIfPresent(Settings.self, forKey: .settings)).flatMap { $0 }
        judgeBreaker = (try? c.decodeIfPresent(BreakerState.self, forKey: .judgeBreaker)).flatMap { $0 }
        hud = (try? c.decodeIfPresent(HudPrefs.self, forKey: .hud)).flatMap { $0 }
    }
    /// A save from stored bytes: anything unreadable is a fresh save, never a crash.
    public static func decode(_ data: Data?) -> SaveData {
        guard let data, let s = try? JSONDecoder().decode(SaveData.self, from: data) else { return SaveData() }
        return s
    }
    public func encoded() -> Data? {
        let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]
        return try? e.encode(self)
    }
    // Values with their merge defaults.
    public var cleanedInitials: String { cleanInitials(initials) }
    public var medalBook: Medals { Medals(medals ?? [:]) }
    public var streak: Daily.Streak { daily ?? Daily.Streak() }
    public var resolvedSettings: Settings { settings ?? Settings() }
    public var hudPrefs: HudPrefs { hud ?? HudPrefs() }
}
