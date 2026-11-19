// The app's health reports (0293; docs/AUDIT-2026-11-18.md): the pure half. The web's `/obs` beacon (src/obs/,
// src/worker/obs.js `cleanObs`) made from Swift. The signatures are the web's (src/obs/signature.js: FNV-1a twice over UTF-16
// → 12 hex digits, the same message normalisation and redaction), the queue dedupes them with counts and survives a crash
// or no network (it's Codable, and the app keeps it in UserDefaults), and MetricKit's diagnostic JSON is mapped here so
// the tests can hold exactly what leaves the phone. The sender (ColdGas/App/Report.swift) only moves these bytes.
//
// What a batch carries: the app's build ("ios-<version>-<build>"), the constant device class "phone-hi" and tier "high",
// and per fault a normalised message, the Swift function and file (or binary offsets for a crash), a module, a kind and a
// count. No id of any kind, no device model, OS version, locale or user content.
import Foundation

public enum Obs {
    public static let endpoint = "https://mutaafaziz.com/coldgas/api/obs"
    /// Distinct faults kept between sends (the rest are counted in `dropped`), and per batch.
    public static let MAX_SIGS = 32, MAX_SEND = 12, MAX_REC = 8
    /// The Worker refuses a body over 8,192 bytes (OBS_LIMITS.maxBytes).
    public static let MAX_BYTES = 8000
    /// Session summaries kept between sends (0300).
    public static let MAX_SESSIONS = 6

    /// MODULE_IDS in src/obs/signature.js (the ones the app uses).
    public enum Module: String, Codable, CaseIterable, Sendable { case app, render, shader, physics, audio, judge, world, net, drive, frame, page }
    /// KIND_IDS in src/obs/signature.js (the ones the app uses).
    public enum Kind: String, Codable, CaseIterable, Sendable { case error, trap, shader, fetch, audio, frame, unclean }
    /// REC_KINDS in src/worker/obs.js (the ones the app uses): a self-heal that happened, and whether it worked.
    public enum Recovery: String, Codable, CaseIterable, Sendable { case webgl, physics, world, audio, degrade, netRetry = "net-retry" }

    // --- signatures (src/obs/signature.js) ------------------------------------------------------------
    static func fnv(_ s: String, _ h0: UInt32) -> UInt32 {
        var h = h0
        for u in s.utf16 { h ^= UInt32(u); h = h &* 0x01000193 }
        return h
    }
    public static func hash12(_ s: String) -> String {
        let a = fnv(s, 0x811c9dc5), b = fnv(s, 0x050c5d1f)
        return String((hex8(a) + hex8(b)).prefix(12))
    }
    private static func hex8(_ v: UInt32) -> String { let s = String(v, radix: 16); return String(repeating: "0", count: 8 - s.count) + s }

    private static func re(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression? { try? NSRegularExpression(pattern: p, options: o) }
    private static func sub(_ s: String, _ r: NSRegularExpression?, _ t: String) -> String {
        guard let r else { return s }
        return r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }
    private static let SECRET = re(#"\b(?:sk|pk|xai|gsk|AIza|key|ant)[-_A-Za-z0-9]{12,}|\b[A-Za-z0-9+/=_-]{32,}\b"#)
    private static let CTRL = re(#"[\x{0000}-\x{001f}\x{007f}]"#)
    private static let URLS = re(#"\b[a-z][a-z0-9+.-]*://[^\s'")]+"#, .caseInsensitive)
    private static let QUOTED = re(#"(["'`])(?:(?!\1).){41,}\1"#)
    private static let HEX0X = re(#"\b0x[0-9a-f]+\b"#, .caseInsensitive)
    private static let HEXID = re(#"\b[0-9a-f]{8,}\b"#, .caseInsensitive)
    private static let NUM = re(#"-?\b[0-9]+(?:\.[0-9]+)?(?:e[-+]?[0-9]+)?\b"#, .caseInsensitive)
    private static let SPACE = re(#"\s+"#)

    /// Anything that could be a secret: provider key shapes and long opaque tokens.
    public static func redact(_ s: String) -> String { sub(s, SECRET, "[redacted]") }
    /// One line, ≤ 160 UTF-16 units, the variable parts folded so that occurrences group (normMessage).
    public static func normMessage(_ msg: String) -> String {
        var s = redact(String(msg.split(separator: "\n", omittingEmptySubsequences: false).first ?? ""))
        s = sub(s, CTRL, " ")
        s = sub(s, URLS, "<url>")
        s = sub(s, QUOTED, "$1…$1")
        s = sub(s, HEX0X, "<hex>")
        s = sub(s, HEXID, "<hex>")
        s = sub(s, NUM, "N")
        s = sub(s, SPACE, " ").trimmingCharacters(in: .whitespaces)
        if s.utf16.count > 160 { s = String(s.utf16.prefix(160)) ?? String(s.prefix(150)) }
        return s
    }

    /// A frame as the Worker's FRAME_RE takes it: `function@File.swift[:line:0]`. `function` is Swift's #function (its
    /// arguments are dropped), `file` its #fileID (the module is dropped).
    public static func frame(function: String, file: String, line: Int? = nil) -> String {
        let fn = String(function.prefix { $0 != "(" }).filter { $0.isASCII && ($0.isLetter || $0.isNumber || "_$.<>[]-".contains($0)) }
        let base = String(file.split(separator: "/").last ?? "").filter { $0.isASCII && ($0.isLetter || $0.isNumber || "_.-".contains($0)) }
        let f = "\(fn.isEmpty ? "<anon>" : String(fn.prefix(40)))@\(base.isEmpty ? "unknown" : String(base.prefix(48)))"
        guard let line, line >= 0 else { return f }
        return "\(f):\(min(line, 9_999_999)):0"
    }
    /// The frame without its line (the key's half): the same fault across builds.
    static func frameKey(_ fr: String) -> String {
        guard let r = fr.range(of: #":\d+:\d+$"#, options: .regularExpression) else { return fr }
        return String(fr[..<r.lowerBound])
    }
    /// "ios-<version>-<build>", as the Worker's BUILD_RE takes it (lowercase, ≤ 24).
    public static func build(version: String, build: String) -> String {
        let clean = { (s: String) in s.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == ".") } }
        let v = clean(version), b = clean(build)
        return String("ios-\(v.isEmpty ? "0" : v)\(b.isEmpty ? "" : "-\(b)")".prefix(24))
    }

    // --- the queue ------------------------------------------------------------------------------------
    public struct Entry: Codable, Equatable, Sendable {
        public var sig: String, key: String, mod: Module, kind: Kind, n: Int, msg: String, fr: String, st: String, build: String
    }
    public struct Rec: Codable, Equatable, Sendable { public var kind: Recovery; public var ok: Bool }

    public struct Queue: Codable, Equatable, Sendable {
        public private(set) var entries: [Entry] = []
        public private(set) var rec: [Rec] = []
        /// Faults beyond MAX_SIGS: counted, not kept.
        public private(set) var dropped = 0
        /// Sessions' summaries waiting to go (0300): the performance summary and the features touched. Optional so a queue
        /// saved before 0300 still reads (its faults aren't lost on the update).
        public private(set) var sessions: [Session]?
        public init() {}

        public static func decode(_ d: Data?) -> Queue { d.flatMap { try? JSONDecoder().decode(Queue.self, from: $0) } ?? Queue() }
        public func encoded() -> Data? { try? JSONEncoder().encode(self) }

        /// Count one occurrence. True when it's a fault not seen before (the caller logs only those).
        @discardableResult
        public mutating func add(_ mod: Module, _ kind: Kind, message: String, frame fr: String, stack st: String = "", build: String, count: Int = 1) -> Bool {
            let msg = Obs.normMessage(message).isEmpty ? kind.rawValue : Obs.normMessage(message)
            let sig = Obs.hash12("\(msg)|\(fr)|\(build)")
            if let i = entries.firstIndex(where: { $0.sig == sig }) { entries[i].n = min(entries[i].n + max(1, count), 1_000_000); return false }
            guard entries.count < MAX_SIGS else { dropped += 1; return false }
            entries.append(Entry(sig: sig, key: Obs.hash12("\(msg)|\(Obs.frameKey(fr))"), mod: mod, kind: kind, n: max(1, count), msg: msg,
                                 fr: fr, st: String(st.prefix(400)), build: build))
            return true
        }
        public mutating func recovered(_ kind: Recovery, ok: Bool) {
            rec.append(Rec(kind: kind, ok: ok))
            if rec.count > MAX_REC { rec.removeFirst(rec.count - MAX_REC) }
        }
        public var isEmpty: Bool { entries.isEmpty && rec.isEmpty && (sessions ?? []).isEmpty }
        /// A session's summary (0300), kept until it's sent; the oldest go first past MAX_SESSIONS.
        public mutating func add(session s: Session) {
            guard s.perf != nil || !s.use.isEmpty else { return }
            var list = sessions ?? []
            list.append(s)
            if list.count > MAX_SESSIONS { list.removeFirst(list.count - MAX_SESSIONS) }
            sessions = list
        }

        /// The next batch: one build's faults (the oldest build first, so a crash from before an update goes under its own
        /// build), ≤ MAX_SEND of them, the recoveries when they're this build's, trimmed to MAX_BYTES. Nil: nothing to send.
        public func next(currentBuild: String) -> Batch? {
            guard !isEmpty else { return nil }
            let build = entries.first?.build ?? sessions?.first?.build ?? currentBuild
            var errs = Array(entries.filter { $0.build == build }.prefix(MAX_SEND))
            let recs = build == currentBuild ? rec : []
            // One session's summary rides with its build's faults (0300): its rows first, so trimming for size drops faults
            // (they wait for the next batch) before it drops the summary.
            let sess = sessions?.first { $0.build == build }
            let rows = sess?.rows ?? []
            var withStacks = true
            while true {
                let body = Obs.body(build: build, errs: rows + errs, rec: recs, stacks: withStacks, fr: sess?.perf?.fr)
                if let body, body.count <= MAX_BYTES {
                    return Batch(build: build, sent: errs.map { ($0.sig, min($0.n, 10_000)) }, recs: recs.count, session: sess != nil, body: body)
                }
                if withStacks { withStacks = false; continue }
                if errs.isEmpty { return nil }
                errs.removeLast()
            }
        }
        /// The Worker took `b`: what it carried leaves the queue (counts added meanwhile stay).
        public mutating func sent(_ b: Batch) {
            for (sig, n) in b.sent {
                guard let i = entries.firstIndex(where: { $0.sig == sig }) else { continue }
                entries[i].n -= n
                if entries[i].n <= 0 { entries.remove(at: i) }
            }
            if b.recs > 0 { rec.removeFirst(min(b.recs, rec.count)) }
            if b.session, let i = sessions?.firstIndex(where: { $0.build == b.build }) { sessions?.remove(at: i) }
        }
        /// Settings → Privacy off: nothing kept.
        public mutating func clear() { self = Queue() }
    }

    /// A session's summary (0300; Perf.swift): what the frames did and which features were touched, for one build.
    public struct Session: Codable, Equatable, Sendable {
        public var build: String
        public var perf: Perf.Summary?
        public var use: Perf.Use
        public init(build: String, perf: Perf.Summary?, use: Perf.Use) { self.build = build; self.perf = perf; self.use = use }
        /// The rows it adds to a batch: `perf …` (module frame) and `use …` (module app), each once, frame `<kind>@<build>`.
        public var rows: [Entry] {
            var out: [Entry] = []
            func row(_ mod: Module, _ kind: Kind, _ msg: String, _ what: String) {
                let m = Obs.normMessage(msg), fr = Perf.frame(what, build: build)
                out.append(Entry(sig: Obs.hash12("\(m)|\(fr)|\(build)"), key: Obs.hash12("\(m)|\(fr)"), mod: mod, kind: kind, n: 1, msg: m, fr: fr, st: "", build: build))
            }
            if let p = perf { row(.frame, .frame, p.message, "perf") }
            if let u = use.message { row(.app, .error, u, "use") }
            return out
        }
    }

    public struct Batch: Equatable, Sendable {
        public let build: String
        let sent: [(String, Int)]
        let recs: Int
        /// It carried the oldest session summary of its build (0300).
        let session: Bool
        public let body: Data
        public static func == (a: Batch, b: Batch) -> Bool { a.build == b.build && a.body == b.body }
        public var count: Int { sent.count }
    }

    /// The `/obs` body (cleanObs's shape, v 1). `first` is false: the digest picks its current build by sessions, and an
    /// iPhone build must not become the web's "current" until the Worker splits by platform (audit B1).
    static func body(build: String, errs: [Entry], rec: [Rec], stacks: Bool, fr: [String: Any]? = nil) -> Data? {
        var o: [String: Any] = [
            "v": 1, "build": build, "dc": "phone-hi", "tier": "high", "first": false, "auto": false,
            "errs": errs.map { e -> [String: Any] in
                ["sig": e.sig, "key": e.key, "mod": e.mod.rawValue, "kind": e.kind.rawValue, "n": min(max(1, e.n), 10_000),
                 "msg": e.msg, "fr": e.fr, "st": stacks ? e.st : ""]
            },
            "rec": rec.map { ["kind": $0.kind.rawValue, "ok": $0.ok] },
        ]
        // A session's frame-time histogram (0300): the Worker keeps it in obs_frames by build, device class and tier.
        if let fr, (fr["n"] as? Int ?? 0) > 0 { o["fr"] = fr }
        return try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])
    }

    // --- MetricKit (MXDiagnosticPayload / MXMetricPayload .jsonRepresentation()) ------------------------
    /// One fault read from a MetricKit payload, ready for `Queue.add`.
    public struct Found: Equatable, Sendable {
        public var mod: Module, kind: Kind, message: String, frame: String, stack: String, build: String, count: Int
    }

    static let EXC: [Int: String] = [1: "EXC_BAD_ACCESS", 2: "EXC_BAD_INSTRUCTION", 3: "EXC_ARITHMETIC", 4: "EXC_EMULATION", 5: "EXC_SOFTWARE",
                                     6: "EXC_BREAKPOINT", 10: "EXC_CRASH", 11: "EXC_RESOURCE", 12: "EXC_GUARD"]
    static let SIG: [Int: String] = [4: "SIGILL", 5: "SIGTRAP", 6: "SIGABRT", 7: "SIGEMT", 8: "SIGFPE", 9: "SIGKILL", 10: "SIGBUS", 11: "SIGSEGV",
                                     12: "SIGSYS", 13: "SIGPIPE", 15: "SIGTERM"]

    /// A diagnostic payload → faults. Only the names of the exception and the signal, the termination reason's kind, a
    /// duration's bucket and the attributed thread's frames (binary offsets) are read; the device type, OS version, region
    /// and every other field are never looked at. `app` is the app's binary name (its frame is the one that groups).
    public static func fromDiagnostics(json: Data, app: String = "ColdGas", fallbackBuild: String) -> [Found] {
        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else { return [] }
        var out: [Found] = []
        func each(_ k: String, _ f: ([String: Any], [String: Any], String) -> Void) {
            for d in (root[k] as? [[String: Any]]) ?? [] {
                let meta = d["diagnosticMetaData"] as? [String: Any] ?? [:]
                f(d, meta, buildOf(meta, fallbackBuild))
            }
        }
        each("crashDiagnostics") { d, meta, b in
            var parts = ["crash"]
            if let e = (meta["exceptionType"] as? NSNumber)?.intValue { parts.append(EXC[e] ?? "EXC_OTHER") }
            if let s = (meta["signal"] as? NSNumber)?.intValue { parts.append(SIG[s] ?? "SIGOTHER") }
            if let name = (meta["exceptionReason"] as? [String: Any])?["exceptionName"] as? String,
               name.range(of: #"^[A-Za-z_]{1,48}$"#, options: .regularExpression) != nil { parts.append(name) }
            let why = (meta["terminationReason"] as? String ?? "").lowercased()
            if why.contains("8badf00d") || why.contains("watchdog") { parts.append("watchdog") }
            else if why.contains("jetsam") || why.contains("memory") { parts.append("memory") }
            let (fr, st) = frames(d, app: app)
            out.append(Found(mod: .app, kind: .unclean, message: parts.joined(separator: " "), frame: fr, stack: st, build: b, count: 1))
        }
        each("hangDiagnostics") { d, meta, b in
            let s = seconds(meta["hangDuration"])
            let (fr, st) = frames(d, app: app)
            out.append(Found(mod: .frame, kind: .frame, message: "main thread hang \(s >= 5 ? "severe" : s >= 2 ? "long" : "short")", frame: fr, stack: st, build: b, count: 1))
        }
        each("cpuExceptionDiagnostics") { d, _, b in
            let (fr, st) = frames(d, app: app)
            out.append(Found(mod: .page, kind: .frame, message: "cpu exception", frame: fr, stack: st, build: b, count: 1))
        }
        each("diskWriteExceptionDiagnostics") { d, _, b in
            let (fr, st) = frames(d, app: app)
            out.append(Found(mod: .page, kind: .error, message: "disk write exception", frame: fr, stack: st, build: b, count: 1))
        }
        each("appLaunchDiagnostics") { d, meta, b in
            let s = seconds(meta["launchDuration"])
            let (fr, st) = frames(d, app: app)
            out.append(Found(mod: .page, kind: .frame, message: "slow launch \(s >= 10 ? "severe" : s >= 4 ? "long" : "short")", frame: fr, stack: st, build: b, count: 1))
        }
        return out
    }

    /// The exits iOS counted over a day that weren't the player's own (a metric payload's applicationExitMetrics). Normal
    /// exits and background memory pressure (the system reclaiming a suspended app) aren't faults.
    static let FOREGROUND_EXITS = ["MemoryResourceLimit", "AppWatchdog", "BadAccess", "IllegalInstruction", "Abnormal",
                                   "CPUResourceLimit", "SuspendedWithLockedFile"]
    static let BACKGROUND_EXITS = ["MemoryResourceLimit", "AppWatchdog", "BadAccess", "IllegalInstruction", "Abnormal",
                                   "CPUResourceLimit", "SuspendedWithLockedFile", "BackgroundTaskAssertionTimeout"]
    public static func fromMetrics(json: Data, fallbackBuild: String) -> [Found] {
        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let exits = root["applicationExitMetrics"] as? [String: Any] else { return [] }
        let meta = root["metaData"] as? [String: Any] ?? [:]
        var m = meta
        if m["appVersion"] == nil, let v = root["latestApplicationVersion"] { m["appVersion"] = v }
        let b = buildOf(m, fallbackBuild)
        var out: [Found] = []
        for (side, names) in [("foreground", FOREGROUND_EXITS), ("background", BACKGROUND_EXITS)] {
            let data = exits["\(side)ExitData"] as? [String: Any] ?? [:]
            for name in names {
                let n = (data["cumulative\(name)ExitCount"] as? NSNumber)?.intValue ?? 0
                guard n > 0 else { continue }
                out.append(Found(mod: .page, kind: side == "foreground" ? .unclean : .error, message: "exit \(side) \(words(name))",
                                 frame: "exit@\(app(side))", stack: "", build: b, count: min(n, 10_000)))
            }
        }
        return out
    }
    private static func app(_ side: String) -> String { side == "foreground" ? "ColdGas" : "ColdGas.background" }
    /// "MemoryResourceLimit" → "memory resource limit".
    static func words(_ s: String) -> String {
        var o = ""
        for (i, c) in s.enumerated() {
            if c.isUppercase && i > 0, let p = o.last, p.isLowercase { o.append(" ") }
            o.append(c)
        }
        return o.lowercased()
    }
    static func buildOf(_ meta: [String: Any], _ fallback: String) -> String {
        guard let v = meta["appVersion"] as? String else { return fallback }
        return build(version: v, build: meta["appBuildVersion"] as? String ?? "")
    }
    /// "2.5 sec", "1,200 ms", 3 → seconds.
    static func seconds(_ v: Any?) -> Double {
        if let n = v as? NSNumber { return n.doubleValue }
        guard let s = v as? String else { return 0 }
        let num = Double(s.replacingOccurrences(of: ",", with: "").split(separator: " ").first ?? "") ?? 0
        return s.contains("ms") ? num / 1000 : s.contains("min") ? num * 60 : num
    }
    /// The attributed thread's frames, top first: `0x<offset>@<binary>`. The first frame in the app's own binary is the one
    /// that groups (the system's top frames are the same for every fault); the stack is the first six.
    static func frames(_ d: [String: Any], app: String) -> (String, String) {
        guard let tree = d["callStackTree"] as? [String: Any], let stacks = tree["callStacks"] as? [[String: Any]] else { return ("unknown@\(app)", "") }
        let thread = stacks.first { ($0["threadAttributed"] as? Bool) == true } ?? stacks.first
        var list: [(String, String)] = []
        var f = (thread?["callStackRootFrames"] as? [[String: Any]])?.first
        while let cur = f, list.count < 24 {
            let bin = String(((cur["binaryName"] as? String) ?? "").filter { $0.isASCII && ($0.isLetter || $0.isNumber || "_.-".contains($0)) }.prefix(48))
            let off = (cur["offsetIntoBinaryTextSegment"] as? NSNumber)?.uint64Value ?? 0
            list.append(("0x\(String(off, radix: 16))", bin.isEmpty ? "unknown" : bin))
            f = (cur["subFrames"] as? [[String: Any]])?.first
        }
        guard !list.isEmpty else { return ("unknown@\(app)", "") }
        let mine = list.first { $0.1 == app } ?? list[0]
        return ("\(mine.0)@\(mine.1)", list.prefix(6).map { "\($0.0)@\($0.1)" }.joined(separator: " < "))
    }
}
