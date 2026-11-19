// Every failure, said once and seen (0293; docs/AUDIT-2026-11-18.md). A failure site calls one line:
//
//   Report.error(.render, .shader, "pipeline cg_plume failed")     // logged, counted, sent later
//   Report.recovered(.webgl, ok: true)                             // a self-heal happened
//
// It goes to os.Logger (subsystem com.mutaafaziz.coldgas, one category per module: Console.app reads it with no network)
// and to the health queue (ColdGasClient's Obs: the web's signatures, deduped with counts, kept in UserDefaults). MetricKit
// adds what the app can't see itself: crashes, hangs, CPU and disk exceptions, slow launches, and the day's exits that
// weren't the player's (a memory kill, a watchdog). The queue goes to the game's own `POST /coldgas/api/obs` (the web's
// endpoint, unchanged), ≤ 8 kB a batch, at most once a minute, from the title, the results or going to the background,
// never in a countdown, a run or a replay. Off under a test or tool flag (WhatsNewGate's rule), and off with Settings →
// Privacy → Share usage stats (nothing kept or sent). DEBUG `-obs-dry` prints each batch; `-obs` lets a tool run send.
import Foundation
import MetricKit
import os
import UIKit
import ColdGasClient

enum Report {
    /// One failure. `message` is ours, never user content; it's normalised and redacted before it's kept.
    static func error(_ mod: Obs.Module, _ kind: Obs.Kind, _ message: String, function: String = #function, file: String = #fileID, line: Int = #line) {
        ReportCenter.shared.add(mod, kind, message, frame: Obs.frame(function: function, file: file, line: line))
    }
    /// A self-heal (the web's obs.recovery): the stage rebuilt, a run ended cleanly after a trap, a retry that landed.
    static func recovered(_ kind: Obs.Recovery, ok: Bool) { ReportCenter.shared.recovered(kind, ok: ok) }
    /// Send what's waiting, if this is a quiet moment and the player allows it.
    @MainActor static func flush() { ReportCenter.shared.flush() }
    /// Settings → Privacy off: drop everything kept.
    static func clear() { ReportCenter.shared.clear() }
    /// At launch: MetricKit, and what the save found.
    @MainActor static func start() { ReportCenter.shared.start() }
}

final class ReportCenter: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = ReportCenter()
    static let KEY = "coldgas.obs.v1"
    static let subsystem = Bundle.main.bundleIdentifier ?? "com.mutaafaziz.coldgas"
    static let build = Obs.build(version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                                 build: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "")
    static let MIN_GAP_S = 60.0

    private let lock = NSLock()
    private var queue: Obs.Queue
    private var dirty = false
    private var sending = false
    private var lastTry = Date.distantPast
    private let allowed: Bool
    private let dry: Bool
    private var started = false

    private override init() {
        queue = Obs.Queue.decode(UserDefaults.standard.data(forKey: ReportCenter.KEY))
        let tool = WhatsNewGate.isQuiet(arguments: Launch.args, environment: ProcessInfo.processInfo.environment)
        #if DEBUG
        dry = Launch.args.contains("-obs-dry")
        allowed = !tool || dry || Launch.args.contains("-obs")
        #else
        dry = false
        allowed = !tool
        #endif
        super.init()
    }

    /// One Logger per module (Console.app: subsystem com.mutaafaziz.coldgas, category = the module).
    private static let loggers: [Obs.Module: Logger] = Dictionary(uniqueKeysWithValues: Obs.Module.allCases.map {
        ($0, Logger(subsystem: ReportCenter.subsystem, category: $0.rawValue))
    })
    private func logger(_ m: Obs.Module) -> Logger { ReportCenter.loggers[m] ?? Logger(subsystem: ReportCenter.subsystem, category: m.rawValue) }

    /// The player's switch, read where it's safe (never from inside SaveStore's own init).
    private var on: Bool { allowed && SaveStore.shared.settings.usageOn }

    func add(_ mod: Obs.Module, _ kind: Obs.Kind, _ message: String, frame: String, stack: String = "", build: String = ReportCenter.build, count: Int = 1) {
        let keep = on
        let log = logger(mod)
        lock.lock()
        let new = keep ? queue.add(mod, kind, message: message, frame: frame, stack: stack, build: build, count: count) : true
        if keep { dirty = true }
        lock.unlock()
        // The first of each fault is logged; repeats are counted, not logged (a fault in a loop can't flood the log).
        if new { log.error("\(kind.rawValue, privacy: .public) \(Obs.normMessage(message), privacy: .public) at \(frame, privacy: .public)") }
        #if DEBUG
        if new { print("REPORT \(mod.rawValue)/\(kind.rawValue) \(Obs.normMessage(message)) at \(frame)") }
        #endif
        if new && keep { persist() }
    }

    func recovered(_ kind: Obs.Recovery, ok: Bool) {
        logger(.app).notice("recovery \(kind.rawValue, privacy: .public) \(ok ? "ok" : "failed", privacy: .public)")
        guard on else { return }
        lock.lock(); queue.recovered(kind, ok: ok); dirty = true; lock.unlock()
        persist()
    }

    /// A session's performance summary and feature use (0300, Instruments.swift): kept like a fault, sent with the next batch.
    func add(session s: Obs.Session) {
        guard on else { return }
        lock.lock(); queue.add(session: s); dirty = true; lock.unlock()
        persist()
    }

    func clear() {
        lock.lock(); queue.clear(); dirty = true; lock.unlock()
        persist()
    }

    private func persist() {
        lock.lock()
        guard dirty else { lock.unlock(); return }
        let d = queue.encoded(); dirty = false
        lock.unlock()
        if let d { UserDefaults.standard.set(d, forKey: ReportCenter.KEY) }
    }

    @MainActor func start() {
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            Report.error(.page, .error, "memory warning")
        }
        let (loaded, failed) = SaveStore.shared.takeIssues()
        switch loaded {
        case .restored(let damaged):
            Report.error(.app, .error, damaged == nil ? "save gone: restored from the mirror" : "save unreadable: restored from the mirror")
        case .lost:
            Report.error(.app, .error, "save unreadable and no mirror: a fresh save")
            Game.shared.notice = Notice(text: "Your saved progress couldn\u{2019}t be read on this iPhone, so this is a fresh start. It\u{2019}s been noted.")
        case .stored, .fresh: break
        }
        if let failed { Report.error(.app, .error, "save write failed: \(failed)") }
    }

    /// Quiet moments only: the title, the results (not a replay), Free Drive's own menu is a drive, so not there either.
    @MainActor private var quiet: Bool {
        let g = Game.shared
        switch g.screen {
        case .title: return true
        case .results: return !g.replaying
        case .run, .drive: return false
        }
    }

    @MainActor func flush() {
        if let f = SaveStore.shared.takeIssues().failed { Report.error(.app, .error, "save write failed: \(f)") }
        persist()
        guard on, quiet, !sending, Date().timeIntervalSince(lastTry) >= ReportCenter.MIN_GAP_S else { return }
        lock.lock(); let batch = queue.next(currentBuild: ReportCenter.build); lock.unlock()
        guard let batch else { return }
        lastTry = Date()
        if dry {
            print("OBS \(String(decoding: batch.body, as: UTF8.self))")
            lock.lock(); queue.sent(batch); dirty = true; lock.unlock(); persist()
            return
        }
        sending = true
        let task = UIApplication.shared.beginBackgroundTask(withName: "obs") {}
        Task.detached(priority: .utility) {
            let ok = await ReportCenter.post(batch.body)
            await MainActor.run {
                self.sending = false
                if ok { self.lock.lock(); self.queue.sent(batch); self.dirty = true; self.lock.unlock(); self.persist() }
                UIApplication.shared.endBackgroundTask(task)
            }
        }
    }

    /// True once the Worker has the batch (2xx; a 202 "sampled" also counts: it won't be stored, and resending won't help).
    /// A 400 means this build makes a batch the Worker refuses: drop it rather than retry it forever.
    private static func post(_ body: Data) async -> Bool {
        guard let url = URL(string: Obs.endpoint) else { return false }
        let req = Net.jsonPost(url, body: body, timeout: 10)
        guard let (_, r) = try? await Net.fetch(req, ms: 10_000) else { return false }
        return (200..<300).contains(r.statusCode) || r.statusCode == 400 || r.statusCode == 413
    }

    // --- MetricKit -----------------------------------------------------------------------------------
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for p in payloads {
            for f in Obs.fromDiagnostics(json: p.jsonRepresentation(), fallbackBuild: ReportCenter.build) {
                add(f.mod, f.kind, f.message, frame: f.frame, stack: f.stack, build: f.build, count: f.count)
            }
        }
    }
    func didReceive(_ payloads: [MXMetricPayload]) {
        for p in payloads {
            for f in Obs.fromMetrics(json: p.jsonRepresentation(), fallbackBuild: ReportCenter.build) {
                add(f.mod, f.kind, f.message, frame: f.frame, build: f.build, count: f.count)
            }
        }
    }
}

/// One calm line over the screens (0293): something went wrong and the player should know, in the game's own voice.
struct Notice: Equatable, Identifiable {
    enum Action: Equatable { case dismiss, retryStage }
    let id = UUID()
    var text: String
    var action: Action = .dismiss
    /// Seconds before it goes by itself (nil: it stays until tapped).
    var seconds: Double? = 7
}
