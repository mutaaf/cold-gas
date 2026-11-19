// The save on this device (docs/NATIVE.md §7): one Codable value in UserDefaults. The value and its merge rules are
// ColdGasClient's SaveData (an old or damaged save decodes, field by field); this is only its home, safe from any thread.
import Foundation
import ColdGasClient

final class SaveStore: @unchecked Sendable {
    static let shared = SaveStore()
    static let KEY = "coldgas.save.v1"
    /// 0293: a store's bytes that wouldn't read, kept aside (never overwritten by the next save), for a later look.
    static let DAMAGED_KEY = "coldgas.save.v1.damaged"
    /// 0293: the mirror, a second copy of the last good save in Application Support (outside UserDefaults' plist, so one
    /// damaged file can't take both). A store that won't read, or that's gone while the mirror is there, is restored from it.
    static let mirrorURL: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("coldgas-save-mirror.json")

    private let defaults: UserDefaults
    private let mirror: URL?
    private let lock = NSLock()
    private var cached: SaveData
    /// How the save was found at launch (Report reads it once the app is up: reporting from here could re-enter `shared`).
    private(set) var loaded: SaveData.Loaded = .fresh

    init(defaults: UserDefaults = .standard, mirror: URL? = SaveStore.mirrorURL) {
        self.defaults = defaults
        self.mirror = mirror
        let stored = defaults.data(forKey: SaveStore.KEY)
        let (s, how) = SaveData.load(stored: stored, mirror: mirror.flatMap { try? Data(contentsOf: $0) })
        cached = s
        loaded = how
        switch how {
        case .stored: if let m = mirror, !FileManager.default.fileExists(atPath: m.path), let d = stored { writeMirror(d) }
        case let .restored(damaged):
            if let damaged { defaults.set(damaged, forKey: SaveStore.DAMAGED_KEY) }
            if let d = s.encoded() { defaults.set(d, forKey: SaveStore.KEY) }
        case let .lost(damaged): defaults.set(damaged, forKey: SaveStore.DAMAGED_KEY)
        case .fresh: break
        }
    }

    var data: SaveData { lock.lock(); defer { lock.unlock() }; return cached }

    /// Change the save and write it, to the store and the mirror. Storage that won't take it keeps the change for this session.
    func update(_ f: (inout SaveData) -> Void) {
        lock.lock(); defer { lock.unlock() }
        let before = cached
        f(&cached)
        guard cached != before else { return }
        guard let d = cached.encoded() else { failed = "encode"; return }
        defaults.set(d, forKey: SaveStore.KEY)
        writeMirror(d)
    }
    /// The last write that failed ("encode", "mirror"), for Report; nil when every write landed.
    private(set) var failed: String?
    private func writeMirror(_ d: Data) {
        guard let m = mirror else { return }
        do {
            try FileManager.default.createDirectory(at: m.deletingLastPathComponent(), withIntermediateDirectories: true)
            try d.write(to: m, options: [.atomic])
        } catch { failed = "mirror" }
    }
    /// Report's one read of what went wrong with the save (cleared once read).
    func takeIssues() -> (loaded: SaveData.Loaded, failed: String?) {
        lock.lock(); defer { lock.unlock() }
        let out = (loaded, failed)
        loaded = .stored; failed = nil
        return out
    }

    // --- initials ------------------------------------------------------------------------------------
    /// Three letters A–Z once they're known, "" until then (src/post.js).
    var initials: String {
        get { data.cleanedInitials }
        set { let v = cleanInitials(newValue); update { $0.initials = v.isEmpty ? nil : v } }
    }

    // --- settings ------------------------------------------------------------------------------------
    var settings: Settings {
        get { data.resolvedSettings }
        set { update { $0.settings = newValue } }
    }
    var units: Units { Units(settings.unitSystem) }

    // --- medals --------------------------------------------------------------------------------------
    func medals(course: String, tier: String) -> Medals.Held { data.medalBook.held(course: course, tier: tier) }
    /// Count a finished run (src/medals.js recordRun).
    @discardableResult
    func recordRun(course: String, tier: String, total: Double) -> Medals.Record {
        var book = data.medalBook
        let r = book.record(course: course, tier: tier, total: total)
        update { $0.medals = book.best }
        return r
    }

    // --- the daily -----------------------------------------------------------------------------------
    static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }
    func streakNow(at ms: Double = SaveStore.nowMs) -> Daily.StreakNow { Daily.streakNow(data.streak, ms) }
    /// Today's objective met: counted once a day.
    @discardableResult
    func completeDaily(at ms: Double = SaveStore.nowMs) -> Daily.Streak {
        let s = Daily.complete(data.streak, ms)
        update { $0.daily = s }
        return s
    }
}
