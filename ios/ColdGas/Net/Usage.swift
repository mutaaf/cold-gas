// Usage events (0246; AGENTS.md §3.3): the thin sender around ColdGasClient's Insights (the vocabulary, the queue, the
// gates and the bytes). Events are added from taps and from the screens' transitions, never from the frame loop; they are
// sent in one batch on the title, on the results and when the app goes to the background, over an ephemeral session with
// no cookies, to Box Office's first-party relay on mutaafaziz.com. A failed send keeps its events for next time.
// Settings → Privacy turns it off: nothing is kept or sent, and the queue and the install id are cleared.
import Foundation
import UIKit
import ColdGasClient

@MainActor
final class Usage {
    static let shared = Usage()
    static let KEY = "coldgas.insights.v1"

    private let defaults = UserDefaults.standard
    private var queue: Insights.Queue
    private var sending = false
    private var firstInputSent = false
    /// When this launch began (first_input's clock).
    static var launchedAt = Date()
    private var backgroundAt: Date?

    /// A test, a capture or a tool driving the app (WhatsNewGate's rule) sends nothing, so our own runs never count as
    /// players. DEBUG `-insights` lets a tool run send anyway; `-insights-dry` prints each batch instead of sending it.
    private let allowed: Bool
    private let dry: Bool

    init() {
        queue = Insights.Queue.decode(defaults.data(forKey: Usage.KEY))
        let tool = WhatsNewGate.isQuiet(arguments: Launch.args, environment: ProcessInfo.processInfo.environment)
        #if DEBUG
        allowed = !tool || Launch.args.contains("-insights")
        dry = Launch.args.contains("-insights-dry")
        #else
        allowed = !tool
        dry = false
        #endif
    }

    var on: Bool { allowed && SaveStore.shared.settings.usageOn }

    private var moment: Insights.Moment {
        let g = Game.shared
        switch g.screen {
        case .title: return .title
        case .drive: return .drive
        case .results: return g.replaying ? .replay : .results
        case .run: return g.countdown > 0 ? .countdown : .run
        }
    }

    /// Name an event (it must be in the vocabulary, or it's dropped).
    func track(_ name: String, _ props: [String: Insights.Value] = [:]) {
        guard queue.add(name, props, at: Date().timeIntervalSince1970 * 1000, moment: moment, on: on) else { return }
        save()
    }

    /// The first input of this launch that reaches the game (the title's Fly, or the pad): its time since launch.
    func firstInput() {
        guard !firstInputSent else { return }
        firstInputSent = true
        track("first_input", ["ms_since_load": .num((Date().timeIntervalSince(Usage.launchedAt) * 1000).rounded())])
    }

    /// A session: at launch, and on coming back after half an hour away.
    func sessionStart() {
        var props: [String: Insights.Value] = [:]
        SaveStore.shared.update { s in var p = s.counters; props = p.startSession(at: Date().timeIntervalSince1970 * 1000); s.progress = p }
        track("session_start", props)
    }
    func didEnterBackground() {
        backgroundAt = Date()
        let id = UIApplication.shared.beginBackgroundTask(withName: "usage") {}
        flush { UIApplication.shared.endBackgroundTask(id) }
    }
    func willEnterForeground() {
        if let t = backgroundAt, Date().timeIntervalSince(t) > 30 * 60 { firstInputSent = false; Usage.launchedAt = Date(); sessionStart() }
        backgroundAt = nil
    }

    /// The run is over (its results are up, or it was left): what it held joins the queue.
    func runOver() { queue.release(); save() }

    /// Settings → Privacy.
    func setOn(_ v: Bool) {
        var st = SaveStore.shared.settings; st.usage = v; SaveStore.shared.settings = st
        if !v { queue.clear(); save() }
    }

    /// Send one batch, off the main thread. Nothing in a quiet moment, nothing when off, one send at a time.
    func flush(done: (() -> Void)? = nil) {
        let batch = queue.next(moment: moment, on: on)
        guard !sending, !batch.isEmpty, let id = queue.installId,
              let body = Insights.body(batch, installId: id, release: Usage.release) else { done?(); return }
        if dry {
            for e in batch { print("INSIGHTS \(e.name) \(e.props.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.line)" }.joined(separator: " "))") }
            queue.sent(batch); save(); done?(); return
        }
        sending = true
        Task.detached(priority: .utility) {
            let ok = await Usage.post(body)
            await MainActor.run {
                self.sending = false
                if ok { self.queue.sent(batch); self.save() }
                done?()
            }
        }
    }

    nonisolated private static func post(_ body: Data) async -> Bool {
        guard let url = URL(string: Insights.endpoint) else { return false }
        // The relay admits an event by its Referer: the game's own page, a general-audience app in Cast List.
        let req = Net.jsonPost(url, body: body, timeout: 10, headers: ["Referer": Insights.referer])
        guard let (_, r) = try? await Net.fetch(req, ms: 10_000) else { return false }
        return (200..<300).contains(r.statusCode)
    }

    private func save() { if let d = queue.encoded() { defaults.set(d, forKey: Usage.KEY) } }

    static let release = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
}

extension Insights.Value {
    var line: String { switch self { case let .num(v): return v == v.rounded() ? String(Int(v)) : String(v); case let .text(s): return s } }
}
