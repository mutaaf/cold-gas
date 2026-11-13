// Usage events (0246, the operator's call 2026-11-13; AGENTS.md §3.3): the web's Box Office vocabulary (0245), sent from the
// app to the same first-party relay. This is the pure half: the vocabulary and its check, the on-disk queue, the gates and
// the batch's bytes. The sender (ColdGas/Net/Insights.swift) only moves these bytes. Nothing else in the app names an event.
//
// Rules: props are numbers and enums only (never initials, free text or ids); the one id is a random install id made on
// this device (a reinstall or the Settings switch resets it); nothing is queued while a run is counting down, flying or
// playing back (those events wait in a small hold and join the queue when the run is over); the queue is capped, the oldest
// dropped first, and a batch is removed only once the relay has taken it.
import Foundation

public enum Insights {
    /// The relay (mutaaf/box-office: `/boxoffice/e/*` forwards PostHog's capture API, and admits an event only when its
    /// Referer is a general-audience Cast List page). The page is the game's own.
    public static let endpoint = "https://mutaafaziz.com/boxoffice/e/batch/"
    public static let referer = "https://mutaafaziz.com/coldgas/"
    /// PostHog's public ingest key, the one Box Office's loader serves to every page (write-only, made for clients).
    public static let token = "phc_pj2w4pWnPNUNK5hZK5TX35tNRFa9skJQrGmZNbHVHr9m"
    public static let QUEUE_CAP = 300
    public static let BATCH_MAX = 50

    // --- the vocabulary (0245: src/metrics/events.js) --------------------------------------------------
    public enum Prop: Equatable {
        case number(ClosedRange<Double>)
        case oneOf([String])
    }
    public static let COURSES = ["show", "wall", "lineup"]
    public static let TIERS = ["assist", "pro", "advanced"]
    public static let LICENSES = ["rookie", "bronze", "silver", "gold", "ace", "legend"]
    public static let VIA = ["file", "link", "copy"]
    static let flag = Prop.number(0...1)
    /// Every event the app may send and every prop it may carry. Same names and props as the web's.
    public static let EVENTS: [String: [String: Prop]] = [
        "session_start": ["returning": flag, "days_since_last": .number(0...3650)],
        "first_input": ["ms_since_load": .number(0...3_600_000)],
        "jump_start": ["n": .number(1...3), "course": .oneOf(COURSES), "tier": .oneOf(TIERS)],
        "jump_end": ["n": .number(1...3), "course": .oneOf(COURSES), "tier": .oneOf(TIERS), "landed": flag, "score": .number(0...200)],
        "first_landing": ["n": .number(1...1000)],
        "share_tap": ["course": .oneOf(COURSES)],
        "share_done": ["course": .oneOf(COURSES), "via": .oneOf(VIA)],
        "challenge_open": ["course": .oneOf(COURSES), "stale": flag],
        "challenge_play": ["course": .oneOf(COURSES), "stale": flag],
        "license_pass": ["license": .oneOf(LICENSES)],
    ]
    /// The props every event carries, as the web's loader registers them (Box Office: app, surface, platform, site).
    public static func base(release: String) -> [String: Value] {
        ["app": .text("cold-gas"), "surface": .text("app"), "platform": .text("ios"), "audience": .text("general"),
         "site": .text("mutaafaziz.com"), "release": .text(release)]
    }

    public enum Value: Codable, Equatable {
        case num(Double), text(String)
        public init(from d: Decoder) throws {
            let c = try d.singleValueContainer()
            if let v = try? c.decode(Double.self) { self = .num(v) } else { self = .text(try c.decode(String.self)) }
        }
        public func encode(to e: Encoder) throws {
            var c = e.singleValueContainer()
            switch self { case let .num(v): try c.encode(v); case let .text(s): try c.encode(s) }
        }
    }

    /// The event if it's in the vocabulary, with only its known props, each inside its range or one of its values; nil for
    /// an unknown name. A prop that breaks its rule is dropped, never sent.
    public static func clean(_ name: String, _ props: [String: Value]) -> [String: Value]? {
        guard let spec = EVENTS[name] else { return nil }
        var out: [String: Value] = [:]
        for (k, v) in props {
            guard let rule = spec[k] else { continue }
            switch (rule, v) {
            case let (.number(r), .num(x)) where x.isFinite && r.contains(x): out[k] = .num(x)
            case let (.oneOf(vals), .text(s)) where vals.contains(s): out[k] = .text(s)
            default: continue
            }
        }
        return out
    }

    /// `n` as the funnel counts it: this device's 1st, 2nd, or 3rd-and-later jump.
    public static func nBucket(_ jumps: Int) -> Double { Double(min(3, max(1, jumps))) }

    // --- events and the queue --------------------------------------------------------------------------
    public struct Event: Codable, Equatable {
        public var name: String
        public var props: [String: Value]
        /// Milliseconds since 1970 (the device clock).
        public var at: Double
        public init(name: String, props: [String: Value], at: Double) { self.name = name; self.props = props; self.at = at }
    }

    /// Where the game is, as the gates read it.
    public enum Moment { case title, countdown, run, replay, results, drive }
    /// Nothing joins the queue (or leaves for the network) while a run counts down, flies or plays back.
    public static func quiet(_ m: Moment) -> Bool { m == .countdown || m == .run || m == .replay }

    /// The queue on disk and the hold for a run in progress. A value: the app keeps one, saves it, and hands the sender a
    /// batch to try.
    public struct Queue: Codable, Equatable {
        public var events: [Event] = []
        /// Events made during a run (first_input on the pad, say): they join `events` when the run is over.
        public var held: [Event] = []
        /// The install id: a random UUID made the first time an event is kept; nil once cleared.
        public var installId: String?
        public init() {}
        enum CodingKeys: String, CodingKey { case events, installId }
        public init(from d: Decoder) throws {
            let c = try d.container(keyedBy: CodingKeys.self)
            events = (try? c.decodeIfPresent([Event].self, forKey: .events)).flatMap { $0 } ?? []
            installId = (try? c.decodeIfPresent(String.self, forKey: .installId)).flatMap { $0 }
            if events.count > QUEUE_CAP { events.removeFirst(events.count - QUEUE_CAP) }
        }

        /// Add an event (checked against the vocabulary). `on` false: nothing is kept. In a quiet moment it's held.
        @discardableResult
        public mutating func add(_ name: String, _ props: [String: Value] = [:], at: Double, moment: Moment, on: Bool) -> Bool {
            guard on, let p = Insights.clean(name, props) else { return false }
            if installId == nil { installId = UUID().uuidString.lowercased() }
            let e = Event(name: name, props: p, at: at)
            if Insights.quiet(moment) { held.append(e); if held.count > 32 { held.removeFirst() } }
            else { events.append(e); cap() }
            return true
        }
        /// The run is over: what it held joins the queue.
        public mutating func release() {
            guard !held.isEmpty else { return }
            events += held; held.removeAll(); cap()
        }
        mutating func cap() { if events.count > QUEUE_CAP { events.removeFirst(events.count - QUEUE_CAP) } }
        /// The next batch to send: the oldest events, at most BATCH_MAX. Empty in a quiet moment or with nothing to send.
        public func next(moment: Moment, on: Bool) -> [Event] {
            guard on, !Insights.quiet(moment), installId != nil else { return [] }
            return Array(events.prefix(BATCH_MAX))
        }
        /// The relay took these: drop them (by value, so events added while the batch was in flight stay).
        public mutating func sent(_ batch: [Event]) {
            var drop = batch.count
            events.removeAll { e in
                guard drop > 0, batch.contains(e) else { return false }
                drop -= 1; return true
            }
        }
        /// Settings → off: nothing kept, and the id is gone (a new one is made if it's turned on again).
        public mutating func clear() { events.removeAll(); held.removeAll(); installId = nil }

        public static func decode(_ data: Data?) -> Queue {
            guard let data, let q = try? JSONDecoder().decode(Queue.self, from: data) else { return Queue() }
            return q
        }
        public func encoded() -> Data? { try? JSONEncoder().encode(self) }
    }

    // --- the batch's bytes (PostHog's /batch/ shape) ---------------------------------------------------
    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    /// The body of one POST. `$geoip_disable`: PostHog derives no location from these (the app's label has no location).
    public static func body(_ batch: [Event], installId: String, release: String) -> Data? {
        let shared = base(release: release)
        let items: [[String: Any]] = batch.map { e in
            var p: [String: Any] = ["distinct_id": installId, "$lib": "coldgas-ios", "$geoip_disable": true]
            for (k, v) in shared { p[k] = v.any }
            for (k, v) in e.props { p[k] = v.any }
            return ["event": e.name, "properties": p, "timestamp": iso.string(from: Date(timeIntervalSince1970: e.at / 1000))]
        }
        return try? JSONSerialization.data(withJSONObject: ["api_key": token, "batch": items], options: [.sortedKeys])
    }

    // --- the session's numbers -------------------------------------------------------------------------
    /// Days since 1970 (UTC), the Daily's day.
    public static func day(_ ms: Double) -> Int { Int((ms / 86_400_000).rounded(.down)) }
}

extension Insights.Value {
    var any: Any { switch self { case let .num(v): return v; case let .text(s): return s } }
}

/// The counters on this device the funnel and the first run read (0246, 0249; 0254's progress store adopts them). Local
/// only: nothing here is sent except as the events' numbers.
public struct Progress: Codable, Equatable {
    /// Scored jumps started (drills, roams and Free Drive aren't jumps), and the ones that landed.
    public var jumps: Int?, landings: Int?
    /// App sessions, and the UTC day of the last one.
    public var sessions: Int?, lastDay: Int?
    /// The jump number of the first landing, and its UTC day; nil until then (the first run is still on).
    public var firstLandingJump: Int?, firstLandingDay: Int?
    /// The guided first jump's hints were skipped ("I've got it").
    public var hintsSkipped: Bool?
    public init() {}
    enum CodingKeys: String, CodingKey { case jumps, landings, sessions, lastDay, firstLandingJump, firstLandingDay, hintsSkipped }
    public init(from d: Decoder) throws {
        guard let c = try? d.container(keyedBy: CodingKeys.self) else { return }
        jumps = (try? c.decodeIfPresent(Int.self, forKey: .jumps)).flatMap { $0 }
        landings = (try? c.decodeIfPresent(Int.self, forKey: .landings)).flatMap { $0 }
        sessions = (try? c.decodeIfPresent(Int.self, forKey: .sessions)).flatMap { $0 }
        lastDay = (try? c.decodeIfPresent(Int.self, forKey: .lastDay)).flatMap { $0 }
        firstLandingJump = (try? c.decodeIfPresent(Int.self, forKey: .firstLandingJump)).flatMap { $0 }
        firstLandingDay = (try? c.decodeIfPresent(Int.self, forKey: .firstLandingDay)).flatMap { $0 }
        hintsSkipped = (try? c.decodeIfPresent(Bool.self, forKey: .hintsSkipped)).flatMap { $0 }
    }
    public var jumpCount: Int { max(0, jumps ?? 0) }
    public var landingCount: Int { max(0, landings ?? 0) }
    /// The first run: until the first landed jump.
    public var firstRun: Bool { firstLandingJump == nil }

    /// A new session: its event's props, and the counters moved on.
    public mutating func startSession(at ms: Double) -> [String: Insights.Value] {
        let today = Insights.day(ms)
        let before = sessions ?? 0
        let since = lastDay.map { max(0, today - $0) } ?? 0
        sessions = before + 1; lastDay = today
        return ["returning": .num(before > 0 ? 1 : 0), "days_since_last": .num(Double(min(3650, since)))]
    }
    /// A scored jump starts: its number on this device.
    public mutating func startJump() -> Int { jumps = jumpCount + 1; return jumpCount }
    /// A scored jump ended. True when this is the first landing.
    public mutating func endJump(landed: Bool, at ms: Double) -> Bool {
        guard landed else { return false }
        landings = landingCount + 1
        guard firstLandingJump == nil else { return false }
        firstLandingJump = max(1, jumpCount); firstLandingDay = Insights.day(ms)
        return true
    }
}
