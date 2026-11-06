// The board, the post and the judges' words (src/panel.js, src/post.js), in the app. The post sends the run's input log and
// its telemetry; the Worker flies nothing on trust, it checks and scores them itself.
//
// Moderation (App Store guideline 1.2: what others post is visible): initials are only three letters, and the app filters the
// ones in BLOCKED both ways (it won't post them, and it shows them as "···"); any row can be hidden on this device or reported
// by mail (long press). The address is the one published on mutaafaziz.com.
import SwiftUI
import ColdGasClient
import ColdGasPhysics

enum Fmt {
    private static var u: Units { SaveStore.shared.units }
    static func speed(_ v: Double) -> String { Units.one(.speed, v, Units.Decimals(0), u.system).split(separator: " ").first.map(String.init) ?? "0" }
    static var speedUnit: String { u.u(.speed) }
    static func length(_ v: Double) -> String { Units.one(.len, v, Units.Decimals(1), u.system).split(separator: " ").first.map(String.init) ?? "0" }
    static var lengthUnit: String { u.u(.len) }
    static func rate(_ v: Double) -> String { Units.one(.rate, v, Units.Decimals(1), u.system).split(separator: " ").first.map(String.init) ?? "0" }
    static var rateUnit: String { u.u(.rate) }
}

/// What this device has done: bests and medals, today's objective.
@MainActor
final class Records {
    static let shared = Records()
    private(set) var lastRecord: Medals.Record?
    func best(_ course: String) -> Double? {
        let m = SaveStore.shared.data.medalBook
        return [m.held(course: course, tier: "assist").best, m.held(course: course, tier: "pro").best].compactMap { $0 }.max()
    }
    func note(_ r: RunResult) {
        lastRecord = SaveStore.shared.recordRun(course: r.course, tier: r.card.tier, total: r.card.total)
        if let sc = r.card.scoreCard, let res = Daily.evaluate(Daily.objectiveFor(SaveStore.nowMs), sc, course: r.course, units: SaveStore.shared.units) {
            r.dailyOK = res.ok
            r.dailyLine = res.ok ? "Daily done" : Daily.missLine(Daily.objectiveFor(SaveStore.nowMs), res, Daily.Pilot(scheme: Game.shared.oneThumb ? .thumb : .classic, tier: r.card.tier))
            if res.ok { SaveStore.shared.completeDaily() }
        }
    }
}

enum Moderation {
    // Three-letter strings not to show or post. Short on purpose: three letters can't say much, and a person can report the rest.
    static let BLOCKED: Set<String> = ["ASS", "FUK", "FUC", "FCK", "SEX", "TIT", "CUM", "NIG", "NGR", "KKK", "FAG", "COK", "DIK", "SHT", "CNT", "VAG", "NAZ", "XXX"]
    static func blocked(_ s: String) -> Bool { BLOCKED.contains(s.uppercased()) }
    private static let KEY = "coldgas.hidden"
    static var hidden: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: KEY) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: KEY) }
    }
    static let reportTo = "mutaaf.aziz@gmail.com"
    static func reportURL(_ r: BoardRow, board: String) -> URL? {
        var c = URLComponents(); c.scheme = "mailto"; c.path = reportTo
        c.queryItems = [URLQueryItem(name: "subject", value: "Cold Gas board report: \(r.initials)"),
                        URLQueryItem(name: "body", value: "Board: \(board)\nCourse: \(r.course ?? "")\nInitials: \(r.initials)\nScore: \(r.total)\n\nWhat's wrong with this entry?\n")]
        return c.url
    }
}

struct BoardView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State var course: String
    @State private var board = ColdGasAPI.Board.today
    @State private var rows: [BoardRow]? = nil
    @State private var loading = true
    @State private var hidden = Moderation.hidden
    var body: some View {
        NavigationStack {
            VStack(spacing: 10) {
                Picker("Course", selection: $course) { ForEach(COURSE_INFO, id: \.id) { Text($0.name.replacingOccurrences(of: "The ", with: "")).tag($0.id) } }.pickerStyle(.segmented)
                Picker("Board", selection: $board) { Text("Today").tag(ColdGasAPI.Board.today); Text("All time").tag(ColdGasAPI.Board.all) }.pickerStyle(.segmented)
                Group {
                    if loading { ProgressView().frame(maxHeight: .infinity) }
                    else if let rows {
                        let shown = rows.filter { !hidden.contains($0.initials) }
                        if shown.isEmpty { empty("Nobody on this board yet. Be first.") }
                        else {
                            ScrollView {
                                LazyVStack(spacing: 0) {
                                    ForEach(Array(shown.enumerated()), id: \.offset) { i, r in row(i, r).contextMenu {
                                        Button("Hide on this device", systemImage: "eye.slash") { hidden.insert(r.initials); Moderation.hidden = hidden }
                                        Button("Report", systemImage: "flag") { if let u = Moderation.reportURL(r, board: board.rawValue) { openURL(u) } }
                                    } }
                                }
                                Text("Touch and hold a row to hide or report it.").font(Theme.text(11)).foregroundStyle(Theme.ink3).padding(.top, 12)
                            }
                        }
                    } else { empty("The board didn’t answer. Check your connection.") }
                }
            }
            .padding(.horizontal, 16).padding(.top, 8)
            .navigationTitle("The board")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task(id: "\(course)-\(board.rawValue)") {
                loading = true
                let r = await ColdGasAPI.production.fetchBoard(board, course: course)
                if !Task.isCancelled { rows = r; loading = false }
            }
        }
    }
    private func empty(_ s: String) -> some View { Text(s).font(Theme.text(14)).foregroundStyle(Theme.ink3).frame(maxHeight: .infinity) }
    private func row(_ i: Int, _ r: BoardRow) -> some View {
        HStack(spacing: 12) {
            Text("\(i + 1)").font(Theme.mono(13)).foregroundStyle(Theme.ink3).frame(width: 24, alignment: .trailing)
            Text(Moderation.blocked(r.initials) ? "···" : r.initials).font(Theme.mono(16, bold: true)).foregroundStyle(Theme.ink)
            Text(r.verdict).font(Theme.text(13)).foregroundStyle(Theme.ink2).lineLimit(1)
            Spacer()
            if r.tier == "pro" || r.tier == "advanced" { Text(r.tier?.uppercased() ?? "").font(Theme.text(9, .medium)).tracking(1).foregroundStyle(Theme.amber) }
            Text(String(format: "%.1f", r.total)).font(Theme.mono(15)).foregroundStyle(Theme.ink)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.hair2).frame(height: 1) }
        .contentShape(Rectangle())
    }
}

/// The post: one dry ask for the rank it would get, then a real post only on the player's press (src/post.js).
@MainActor
final class PostModel: ObservableObject {
    @Published var initials = SaveStore.shared.initials
    @Published var editing = SaveStore.shared.initials.count != 3
    @Published var rankText = ""
    @Published var message = ""
    @Published var posting = false
    @Published var posted = false
    private var asked: UUID?
    func askRank(_ r: RunResult) async {
        guard r.eligible, asked != r.id else { return }
        asked = r.id
        let rank = await ColdGasAPI.production.dryRank(log: r.log, t: r.telemetry.json, course: r.course)
        rankText = rankLabel(rank)
    }
    func post(_ r: RunResult) async {
        let ini = cleanInitials(initials)
        guard ini.count == 3 else { message = "Three letters."; editing = true; return }
        guard !Moderation.blocked(ini) else { message = "Try three other letters."; editing = true; return }
        guard !posted, !posting else { return }
        SaveStore.shared.initials = ini
        initials = ini; editing = false; posting = true; message = "Posting…"
        let res = await ColdGasAPI.production.postScore(log: r.log, t: r.telemetry.json, initials: ini, course: r.course)
        posting = false; posted = res.ok
        message = postMessage(res)
        UINotificationFeedbackGenerator().notificationOccurred(res.ok ? .success : .warning)
    }
}

struct PostRow: View {
    let result: RunResult
    @ObservedObject var post: PostModel
    var body: some View {
        if result.eligible {
            VStack(alignment: .leading, spacing: 8) {
                if !post.posted {
                    HStack(spacing: 8) {
                        if post.editing {
                            TextField("", text: $post.initials, prompt: Text("ABC").foregroundStyle(Theme.ink3))
                                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                .font(Theme.mono(16, bold: true)).multilineTextAlignment(.center)
                                .frame(width: 76, height: 44).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hair))
                                .onChange(of: post.initials) { _, v in let c = cleanInitials(v); if c != v { post.initials = c } }
                                .accessibilityLabel("Three initials")
                        }
                        Button { Task { await post.post(result) } } label: {
                            Text(label).lineLimit(1).minimumScaleFactor(0.8).frame(maxWidth: .infinity)
                        }.buttonStyle(CGButton()).disabled(post.posting)
                        if !post.editing { Button("Edit") { post.editing = true }.font(Theme.text(13)).foregroundStyle(Theme.ink2) }
                    }
                }
                if !post.message.isEmpty { Text(post.message).font(Theme.text(13)).foregroundStyle(Theme.ink2) }
            }
            .task(id: result.id) { await post.askRank(result) }
        }
    }
    private var label: String {
        let ini = post.editing ? "" : " · \(post.initials)", rank = post.rankText.isEmpty ? "" : " · \(post.rankText)"
        return "Post\(ini)\(rank)"
    }
}

/// The judges' words: the free edge model streaming, the local lines if it can't (labelled, never passed off as the model's).
/// Asked once per run, here rather than in the view: the sheet may be rebuilt as it grows, and the call is rate limited.
@MainActor
final class JudgesModel: ObservableObject {
    @Published var words = JudgeWords()
    @Published var note = ""
    private var asked: UUID?
    private var task: Task<Void, Never>?
    func ask(_ r: RunResult) {
        guard asked != r.id, let sc = r.card.scoreCard else { return }
        asked = r.id
        task?.cancel()
        task = Task { [weak self] in
            let stream = JudgesClient().judges(run: JudgedRun(course: r.course, assist: r.card.tier == "assist"), log: r.log, t: r.telemetry.json, card: sc)
            for await e in stream {
                guard let self else { return }
                switch e {
                case let .token(_, w): self.words = w
                case let .finished(w, meta):
                    self.words = w
                    self.note = meta.ok ? "Words by the edge model" : (meta.error ?? "The judges’ local lines")
                default: break
                }
            }
        }
    }
    deinit { task?.cancel() }
}

/// The judges at a glance: three scores, and a tap on one shows what that judge said. Until then, the panel's headline. Whose
/// words these are stays on screen whichever is showing (invariant 5½). `open` lives on the sheet, which may be rebuilt as it grows.
struct JudgePanel: View {
    let judges: [(id: String, score: Double)]
    let celebrate: Bool
    @ObservedObject var model: JudgesModel
    @Binding var open: String?
    @Environment(\.accessibilityReduceMotion) private var still
    var body: some View {
        let words = model.words
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) { ForEach(Array(judges.enumerated()), id: \.offset) { i, j in tile(j.id, j.score, index: i) } }
            let said = open.map { said(words, $0) } ?? words.headline
            if !said.isEmpty {
                Text(said).font(Theme.text(14, open == nil ? .medium : .regular)).foregroundStyle(open == nil ? Theme.ink : Theme.ink2).fixedSize(horizontal: false, vertical: true)
            } else if open != nil {
                Text("Still deciding.").font(Theme.text(14)).foregroundStyle(Theme.ink3)
            }
            if !model.note.isEmpty {
                Text(open == nil ? "\(model.note) · Tap a judge for their call" : model.note).font(Theme.text(11)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    private func said(_ w: JudgeWords, _ id: String) -> String {
        id == "engineer" ? w.engineer : id == "coordinator" ? w.coordinator : id == "designer" ? w.designer : ""
    }
    private func tile(_ id: String, _ score: Double, index: Int) -> some View {
        let on = open == id
        let name = JUDGE_NAMES[id] ?? id
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(still ? nil : .snappy(duration: 0.2)) { open = on ? nil : id }
        } label: {
            VStack(spacing: 4) {
                Text(name).font(Theme.text(10, .medium)).tracking(0.8).lineLimit(1).minimumScaleFactor(0.7)
                    .foregroundStyle(on ? (celebrate ? Theme.auroraInk2 : Theme.bg.opacity(0.8)) : Theme.ink3)
                Text(String(format: "%.1f", score)).font(Theme.mono(22))
                    .foregroundStyle(on ? (celebrate ? Theme.auroraInk : Theme.bg) : Theme.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 44).padding(.vertical, 8)
            .background { if on && !celebrate { RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.ink) } }
            .modifier(TileField(on: on && celebrate, phase: CGFloat(index) * 190))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(on ? .clear : Theme.hair))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name.capitalized)
        .accessibilityValue(String(format: "%.1f", score))
        .accessibilityHint(on ? "Hide this judge's call" : "Show this judge's call")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

private struct TileField: ViewModifier {
    let on: Bool
    let phase: CGFloat
    func body(content: Content) -> some View {
        if on { content.aurora(10, phase: phase) } else { content }
    }
}
