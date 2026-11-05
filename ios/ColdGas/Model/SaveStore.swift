// The save on this device (docs/NATIVE.md §7): one Codable value in UserDefaults. The value and its merge rules are
// ColdGasClient's SaveData (an old or damaged save decodes, field by field); this is only its home, safe from any thread.
import Foundation
import ColdGasClient

final class SaveStore: @unchecked Sendable {
    static let shared = SaveStore()
    static let KEY = "coldgas.save.v1"

    private let defaults: UserDefaults
    private let lock = NSLock()
    private var cached: SaveData

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        cached = SaveData.decode(defaults.data(forKey: SaveStore.KEY))
    }

    var data: SaveData { lock.lock(); defer { lock.unlock() }; return cached }

    /// Change the save and write it. Storage that won't take it keeps the change for this session.
    func update(_ f: (inout SaveData) -> Void) {
        lock.lock(); defer { lock.unlock() }
        let before = cached
        f(&cached)
        if cached != before, let d = cached.encoded() { defaults.set(d, forKey: SaveStore.KEY) }
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
