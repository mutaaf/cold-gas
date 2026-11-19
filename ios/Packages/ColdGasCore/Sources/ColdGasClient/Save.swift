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
    /// 0246: Settings → Privacy → Share usage stats. Off sends nothing and clears the queue and the install id.
    public var usage: Bool?
    public init() {}
    enum CodingKeys: String, CodingKey { case haptics, sound, scheme, hand, tilt, units, judgeOnDevice, usage }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        haptics = try? c.decodeIfPresent(Bool.self, forKey: .haptics)
        sound = try? c.decodeIfPresent(Bool.self, forKey: .sound)
        scheme = try? c.decodeIfPresent(ControlScheme.self, forKey: .scheme)
        hand = try? c.decodeIfPresent(Hand.self, forKey: .hand)
        tilt = try? c.decodeIfPresent(Bool.self, forKey: .tilt)
        units = try? c.decodeIfPresent(UnitSystem.self, forKey: .units)
        judgeOnDevice = try? c.decodeIfPresent(Bool.self, forKey: .judgeOnDevice)
        usage = try? c.decodeIfPresent(Bool.self, forKey: .usage)
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
    /// On by default (0246), as the web's analytics are; one switch turns it off.
    public var usageOn: Bool { usage ?? true }
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
    /// The counters on this device (0246, 0249): jumps, landings, sessions, the first landing.
    public var progress: Progress?
    /// Wreck Club (0242): the feats, the sets landed, the paint chosen. A save from before it has none.
    public var club: WreckClub.Book?
    public init() {}
    enum CodingKeys: String, CodingKey { case initials, medals, daily, settings, judgeBreaker, hud, progress, club }
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
        progress = (try? c.decodeIfPresent(Progress.self, forKey: .progress)).flatMap { $0 }
        club = (try? c.decodeIfPresent(WreckClub.Book.self, forKey: .club)).flatMap { $0 }
    }
    /// A save from stored bytes: anything unreadable is a fresh save, never a crash.
    public static func decode(_ data: Data?) -> SaveData {
        guard let data, let s = try? JSONDecoder().decode(SaveData.self, from: data) else { return SaveData() }
        return s
    }
    /// Bytes a save can be read from: a JSON object (damaged fields inside it still cost only themselves).
    public static func readable(_ data: Data?) -> Bool {
        guard let data, !data.isEmpty else { return false }
        return (try? JSONSerialization.jsonObject(with: data)) is [String: Any]
    }

    /// How a save was found at launch (0293): the store's own bytes, the mirror's when the store's were damaged or gone, or
    /// a fresh save. `damaged` is the store's bytes that wouldn't read, kept aside rather than overwritten.
    public enum Loaded: Equatable {
        case fresh, stored
        case restored(damaged: Data?)
        case lost(damaged: Data)
    }
    /// The save from the store's bytes and the mirror's (a second copy kept in a file, outside UserDefaults).
    public static func load(stored: Data?, mirror: Data?) -> (SaveData, Loaded) {
        if readable(stored) { return (decode(stored), .stored) }
        let damaged = (stored?.isEmpty ?? true) ? nil : stored
        if readable(mirror) { return (decode(mirror), .restored(damaged: damaged)) }
        if let damaged { return (SaveData(), .lost(damaged: damaged)) }
        return (SaveData(), .fresh)
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
    public var counters: Progress { progress ?? Progress() }
}
