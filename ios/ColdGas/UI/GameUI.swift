// The screens over the stage (0154), in SwiftUI, placed by the fold (docs/NATIVE.md §5):
//   single (Pro Max, the Duo's outer screen) and full (the Duo open): over the scene, edge to edge, inside the safe area;
//   rows (the Duo in tabletop): the HUD over the scene above the fold, the controller filling the panel below it.
// The title, the run's HUD and controls, the results; the board and the settings as sheets.
import SwiftUI
import ColdGasClient
import ColdGasCore
import ColdGasLayout
import ColdGasPhysics

/// Where the panels are, from the root's fold layout (points, in the hosting view's coordinates).
final class LayoutModel: ObservableObject {
    @Published var spread: Spread = .single
    @Published var scene: CGRect = .zero
    @Published var controls: CGRect = .zero
    @Published var safe: EdgeInsets = EdgeInsets()
}

struct RootUI: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    @State private var sheet: Sheet?
    /// What's new after an update (WhatsNewView.swift): read once per launch, shown over the title, never during a run.
    @State private var whatsNew: ReleaseNotes? = RootUI.launchNotes
    private static let launchNotes = WhatsNewStore.atLaunch()
    enum Sheet: String, Identifiable {
        case board, settings, howTo, practice; var id: String { rawValue }
        /// A What's new callout's destination (exhaustive: a new destination has to be routed here to build).
        init(_ d: WhatsNewDestination) {
            switch d {
            case .board: self = .board
            case .settings: self = .settings
            case .howTo: self = .howTo
            case .practice: self = .practice
            }
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            switch game.screen {
            case .title: TitleView(open: { sheet = $0 }).frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
            case .run: RunView(layout: layout)
            case .results:
                if let r = game.result {
                    if !game.replaying {   // the post and the judges' words live on the result, so they survive watching it back
                        ResultsView(result: r, open: { sheet = $0 }, post: r.post, judges: r.judges)
                            .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
                    } else {
                        Button { game.stopWatching() } label: { Text("Back to the score") }
                            .buttonStyle(CGButton())
                            .frame(width: layout.controls.width, height: layout.controls.height, alignment: .bottom)
                            .offset(x: layout.controls.minX, y: layout.controls.minY - 16)
                    }
                }
            }
            if game.screen == .title, let n = whatsNew {
                WhatsNewView(notes: n, dismiss: { withAnimation(.easeOut(duration: 0.2)) { whatsNew = nil } }, go: { d in
                    // A callout takes you to its feature: the modal closes and that sheet opens over the title.
                    withAnimation(.easeOut(duration: 0.2)) { whatsNew = nil }
                    sheet = Sheet(d)
                })
                    .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
                    .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .sheet(item: $sheet) { s in
            Group {
                switch s {
                case .board: BoardView(course: game.course)
                case .settings: SettingsView()
                case .howTo: HowToView()
                case .practice: PracticeView(start: { id in sheet = nil; game.play(drill: id) })
                }
            }
            .presentationDetents([.large])
            .presentationBackground(Theme.bg.opacity(0.94))
            .preferredColorScheme(.dark)
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Title

let COURSE_INFO: [(id: String, name: String, line: String)] = [
    ("show", "The Show", "Up the Wall, out over the parked row, onto the mark"),
    ("wall", "The Wall", "Climb the curl on suction, let go upside down, land it"),
    ("lineup", "The Lineup", "Off the kicker, a barrel roll over the line, wheels down"),
]

struct TitleView: View {
    @ObservedObject var game = Game.shared
    var open: (RootUI.Sheet) -> Void
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("COLD GAS").font(Theme.display(13)).tracking(6).foregroundStyle(Theme.ink2)
                Spacer()
                iconButton("scope", "Practice") { open(.practice) }
                iconButton("list.number", "Board") { open(.board) }
                iconButton("questionmark", "How to play") { open(.howTo) }
                iconButton("gearshape", "Settings") { open(.settings) }
            }
            .padding(.horizontal, 20).padding(.top, 14)
            Spacer(minLength: 12)
            // A short panel (tabletop, a phone on its side): the choices scroll, Fly stays on screen.
            ViewThatFits(in: .vertical) {
                VStack(spacing: 14) { choices; fly }.padding(18).glass(20).frame(maxWidth: 440).padding(.horizontal, 16).padding(.bottom, 16)
                VStack(spacing: 10) { ScrollView { choices }.scrollBounceBehavior(.basedOnSize); fly }.padding(14).glass(20).frame(maxWidth: 440).padding(.horizontal, 16).padding(.bottom, 12)
            }
        }
    }
    private var fly: some View {
        Button { game.play() } label: { Text("Fly \(COURSE_INFO.first { $0.id == game.course }?.name ?? "")").frame(maxWidth: .infinity) }
            .buttonStyle(CGButton(primary: true))
            .accessibilityIdentifier("play")
    }
    private var choices: some View {
            VStack(alignment: .leading, spacing: 14) {
                Text("A nitrogen-jet stunt car. Ten cold-gas thrusters, one landing, three judges.")
                    .font(Theme.text(14)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 8) {
                    ForEach(COURSE_INFO, id: \.id) { c in
                        Button { game.course = c.id; UISelectionFeedbackGenerator().selectionChanged() } label: {
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(c.name.uppercased()).font(Theme.display(13)).tracking(2.4).foregroundStyle(Theme.ink)
                                    Text(c.line).font(Theme.text(12)).foregroundStyle(Theme.ink3).lineLimit(2)
                                }
                                Spacer()
                                if let best = Records.shared.best(c.id) { Text(String(format: "%.1f", best)).font(Theme.mono(14)).foregroundStyle(Theme.ink2) }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(game.course == c.id ? Theme.ink.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(game.course == c.id ? Theme.ink.opacity(0.55) : Theme.hair, lineWidth: 1))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(game.course == c.id ? .isSelected : [])
                    }
                }
                HStack(spacing: 8) {
                    ForEach([("assist", "Assist"), ("pro", "Pro"), ("advanced", "Advanced")], id: \.0) { t in
                        Button { game.tier = t.0; UISelectionFeedbackGenerator().selectionChanged() } label: {
                            Text(t.1.uppercased()).font(Theme.text(12, .medium)).tracking(1.6)
                                .foregroundStyle(game.tier == t.0 ? Theme.ink : Theme.ink3)
                                .frame(maxWidth: .infinity, minHeight: 36)
                                .overlay(Capsule().strokeBorder(game.tier == t.0 ? (t.0 == "pro" ? Theme.amber.opacity(0.7) : t.0 == "advanced" ? Theme.signal : Theme.ink.opacity(0.6)) : Theme.hair, lineWidth: 1))
                                .contentShape(Capsule())
                        }.buttonStyle(.plain)
                    }
                }
                let dailyObj = Daily.objectiveFor(SaveStore.nowMs), streak = SaveStore.shared.streakNow()
                Text("Today: \(dailyObj.goal(SaveStore.shared.units)) · \(Daily.courseName(dailyObj.course))\(streak.doneToday ? " · done" : "")\(streak.streak > 1 ? " · \(streak.streak) day streak" : "")")
                    .font(Theme.text(12, .medium)).foregroundStyle(streak.doneToday ? Theme.ok : Theme.ink2).fixedSize(horizontal: false, vertical: true)
                Text(game.tier == "assist" ? "Assist: the flight computer rolls you out and brakes. One thumb on the Show and the Wall." : game.tier == "pro" ? "Pro: you fly the roll-out and the brake yourself. Scores ×1.08." : "Advanced: all ten valves by hand, off the Wall. Scores ×1.15.")
                    .font(Theme.text(12)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
            }
    }
    private func iconButton(_ name: String, _ label: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: name).font(.system(size: 15, weight: .regular)).foregroundStyle(Theme.ink2)
                .frame(width: 40, height: 40).glass(20)
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}

// MARK: - The run

struct RunView: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    var body: some View {
        let rows = layout.spread == .rows
        let sceneSafe = CGRect(x: layout.scene.minX + layout.safe.leading, y: layout.scene.minY + layout.safe.top,
                               width: layout.scene.width - layout.safe.leading - (rows ? 0 : layout.safe.trailing),
                               height: layout.scene.height - layout.safe.top - (rows ? 0 : layout.safe.bottom))
        ZStack(alignment: .topLeading) {
            HUDView(compact: !rows && layout.controls.height < 520, cueLift: rows || layout.scene.width > layout.scene.height ? 0 : (game.tier == "advanced" && (game.hud.phase == 2 || game.hud.released) ? min(330, layout.controls.width) * 380 / 300 + 12 : 196))
                .frame(width: sceneSafe.width, height: sceneSafe.height).offset(x: sceneSafe.minX, y: sceneSafe.minY)
            ControllerView(panel: rows)
                .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
            if game.countdown > 0 {
                Text("\(game.countdown)").font(Theme.display(64)).foregroundStyle(Theme.ink)
                    .frame(width: sceneSafe.width, height: sceneSafe.height).offset(x: sceneSafe.minX, y: sceneSafe.minY)
                    .transition(.opacity).id(game.countdown)
            }
            if game.paused { PauseView().frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY) }
        }
    }
}

struct HUDView: View {
    @ObservedObject var game = Game.shared
    var compact: Bool
    var cueLift: CGFloat = 0   // above the pads when they're over the scene
    var body: some View {
        let h = game.hud
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                Button { game.paused = true; UISelectionFeedbackGenerator().selectionChanged() } label: {
                    Image(systemName: "pause.fill").font(.system(size: 13)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40).glass(20)
                }.buttonStyle(.plain).accessibilityLabel("Pause")
                Spacer()
                HStack(spacing: 16) {
                    readout("SPEED", Fmt.speed(h.speed), Fmt.speedUnit)
                    readout("ALT", Fmt.length(h.alt), Fmt.lengthUnit)
                    if h.phase == 2 { readout("SINK", Fmt.rate(h.sink), Fmt.rateUnit, color: [Theme.ink, Theme.amber, Theme.hot][h.sinkBand]) }
                }
                .padding(.horizontal, 14).padding(.vertical, 8).glass(12)
            }
            HStack {
                Spacer()
                gasBar(h.gas).frame(width: compact ? 120 : 160)
            }.padding(.top, 8)
            Spacer()
            if !h.cue.isEmpty {
                Text(h.cue).font(Theme.text(compact ? 13 : 15, .medium)).foregroundStyle(Theme.ink)
                    .padding(.horizontal, 14).padding(.vertical, 8).glass(18)
                    .transition(.opacity).id(h.cue)
                    .accessibilityAddTraits(.updatesFrequently)
                    .padding(.bottom, 8 + cueLift)
            }
        }
        .padding(12)
        .animation(.easeOut(duration: 0.25), value: h.cue)
    }
    private func readout(_ label: String, _ v: String, _ unit: String, color: Color = Theme.ink) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label).font(Theme.text(9, .medium)).tracking(1.4).foregroundStyle(Theme.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(v).font(Theme.mono(compact ? 16 : 19)).foregroundStyle(color).monospacedDigit()
                Text(unit).font(Theme.text(10)).foregroundStyle(Theme.ink3)
            }
        }
    }
    private func gasBar(_ g: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text("N₂").font(Theme.text(9, .medium)).tracking(1.4).foregroundStyle(Theme.ink3); Spacer(); Text("\(Int((g * 100).rounded(.down)))%").font(Theme.mono(10)).foregroundStyle(Theme.ink2) }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.hair2)
                    Capsule().fill(g < 0.15 ? Theme.hot : Theme.ice.opacity(0.85)).frame(width: geo.size.width * g)
                }
            }.frame(height: 4)
        }
        .padding(.horizontal, 12).padding(.vertical, 8).glass(12)
        .accessibilityElement(children: .combine).accessibilityLabel("Nitrogen \(Int(g * 100)) percent")
    }
}

struct PauseView: View {
    @ObservedObject var game = Game.shared
    var body: some View {
        ZStack {
            Color.black.opacity(0.45)
            VStack(spacing: 12) {
                Text("PAUSED").font(Theme.display(16)).tracking(5).foregroundStyle(Theme.ink)
                Button("Resume") { game.paused = false }.buttonStyle(CGButton(primary: true))
                Button("Restart") { game.retry() }.buttonStyle(CGButton())
                Button("Home") { game.home() }.buttonStyle(CGButton())
            }
            .padding(24).glass(20)
        }
    }
}

// MARK: - Results

struct ResultsView: View {
    @ObservedObject var game = Game.shared
    let result: RunResult
    var open: (RootUI.Sheet) -> Void
    @ObservedObject var post: PostModel
    @ObservedObject var judges: JudgesModel
    @State private var openJudge: String?
    @State private var numbersOpen = false
    var body: some View {
        let card = result.card
        GeometryReader { g in
            // Under the height of a big phone the actions take one row, to leave the score and the judges the room.
            // A very short space (a Duo in tabletop) shrinks the score as well, or the actions would cover it.
            let oneRow = g.size.height < 720, short = g.size.height < 470
            VStack {
                Spacer(minLength: 8)
                // Post and the buttons stay on screen; on a short screen or a long verdict, the details scroll above them.
                ViewThatFits(in: .vertical) {
                    VStack(alignment: .leading, spacing: 14) { sheet(card, short: short); actions(card, short: oneRow) }.padding(18)
                    VStack(alignment: .leading, spacing: short ? 8 : 12) {
                        ScrollViewReader { reader in
                            ScrollView { sheet(card, short: short).padding(.bottom, 4) }
                                .scrollBounceBehavior(.basedOnSize)
                                // What you opened comes into view. On appear too: opening it may be what made the sheet need a
                                // scroll view, and a new one never sees the change. After a beat, once the row has its height.
                                .task(id: numbersOpen) {
                                    guard numbersOpen else { return }
                                    try? await Task.sleep(for: .milliseconds(60))
                                    withAnimation(.snappy(duration: 0.24)) { reader.scrollTo("numbers", anchor: .bottom) }
                                }
                        }
                        actions(card, short: oneRow)
                    }.padding(short ? 12 : 18)
                }
                .glass(20)
                .frame(maxWidth: 480)
                .padding(.horizontal, 16).padding(.bottom, short ? 8 : 16)
            }
            .frame(maxWidth: .infinity)
        }
        .onAppear { if result.drill == nil { judges.ask(result) } }
    }
    private func flag(_ card: Card, _ key: String) -> Bool? {
        guard let v = card.flat.first(where: { $0.0 == "facts." + key })?.1, case let .b(b) = v else { return nil }
        return b
    }
    /// src/ui.js's rule: a crash, a wreck or no jump at all is never celebrated. (`crashed` includes the wreck.)
    private func celebrated(_ card: Card) -> Bool { flag(card, "crashed") != true && flag(card, "jumped") != false }

    private func sheet(_ card: Card, short: Bool) -> some View {
                VStack(alignment: .leading, spacing: 14) {
                    scoreField(card, short: short)
                    if result.drill == nil {
                        JudgePanel(judges: card.judges, celebrate: celebrated(card), model: judges, open: $openJudge)
                    }
                    if let d = result.dailyLine { Text(d).font(Theme.text(13)).foregroundStyle(result.dailyOK ? Theme.ok : Theme.ink2).fixedSize(horizontal: false, vertical: true) }
                    if let d = result.drill {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(d.label.uppercased()).font(Theme.text(9, .medium)).tracking(1.4).foregroundStyle(Theme.ink3)
                            Text(d.headline).font(Theme.text(14, .medium)).foregroundStyle(d.pass ? Theme.ok : Theme.amber).fixedSize(horizontal: false, vertical: true)
                            ForEach(d.stats, id: \.self) { Text($0).font(Theme.mono(11)).foregroundStyle(Theme.ink2) }
                        }
                    }
                    // The coach's "clean" is praise: not after a crash, where its only finding can still be that one.
                    if let c = result.coach.first, c.id != "clean" || celebrated(card) {
                        HStack(alignment: .top, spacing: 10) {
                            RoundedRectangle(cornerRadius: 1.5).fill(c.id == "clean" ? Theme.aur1 : Theme.amber).frame(width: 3)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(c.id == "clean" ? "NEXT RUN" : "WHAT COST YOU").font(Theme.text(9, .medium)).tracking(1.4).foregroundStyle(Theme.ink3)
                                Text(c.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                                Text(c.fix.isEmpty ? c.detail : c.fix).font(Theme.text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityElement(children: .combine)
                    }
                    Accordion(title: "The numbers", summary: numbersLine(result.telemetry), isOpen: $numbersOpen) { facts(result.telemetry) }.id("numbers")
                }
    }
    /// The score is the one thing the sheet has to say at a glance: bright for a landing, plain for a crash.
    @ViewBuilder private func scoreField(_ card: Card, short: Bool) -> some View {
        let lit = celebrated(card)
        let ink = lit ? Theme.auroraInk : Theme.ink, ink2 = lit ? Theme.auroraInk2 : Theme.ink3
        let field = VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(format: "%.1f", card.total)).font(Theme.mono(short ? 34 : 46, bold: true)).foregroundStyle(ink).monospacedDigit()
                Text("/ 100").font(Theme.mono(14)).foregroundStyle(ink2)
                Spacer()
                Text(card.tier.uppercased()).font(Theme.text(11, .medium)).tracking(1.6).foregroundStyle(lit ? ink : card.tier == "assist" ? Theme.ink2 : Theme.amber)
                    .padding(.horizontal, 10).padding(.vertical, 5).overlay(Capsule().strokeBorder(lit ? Theme.auroraInk.opacity(0.35) : Theme.hair))
            }
            Text(card.verdict).font(Theme.text(17, .semibold)).foregroundStyle(ink).fixedSize(horizontal: false, vertical: true)
            if let m = Records.shared.lastRecord, let medal = m.earned {
                Text("\(medal.label) medal\(m.isNew ? " · new" : "")").font(Theme.text(13, .semibold)).foregroundStyle(lit ? ink : Theme.amber)
            }
        }
        .padding(short ? 10 : 14).frame(maxWidth: .infinity, alignment: .leading)
        if lit { field.aurora(14) } else { field.overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hair)) }
    }
    private func numbersLine(_ t: Telemetry) -> String {
        "Sink \(Fmt.rate(t.sink)) \(Fmt.rateUnit) · Tilt \(String(format: "%.0f°", t.tiltDeg))"
    }
    private func actions(_ card: Card, short: Bool) -> some View {
                VStack(alignment: .leading, spacing: short ? 8 : 10) {
                    PostRow(result: result, post: post)
                    let again = Button { game.retry() } label: { Text(result.drill == nil ? "Fly again" : "Again").frame(maxWidth: .infinity) }
                    if short {
                        // One row, the secondary actions as icons, each still saying its name.
                        HStack(spacing: 6) {
                            again.buttonStyle(CGButton(primary: true, compact: true))
                            iconAction("play.rectangle", "Watch it") { game.watch() }
                            share(card)
                            iconAction("list.number", "Board") { open(.board) }
                            iconAction("house", "Home") { game.home() }
                        }
                    } else {
                        VStack(spacing: 10) {
                            again.buttonStyle(CGButton(primary: true))
                            HStack(spacing: 8) {
                                Button { game.watch() } label: { Text("Watch it").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                                share(card)
                                Button { open(.board) } label: { Text("Board").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                                Button { game.home() } label: { Text("Home").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                            }
                        }
                    }
                }
    }
    private func iconAction(_ icon: String, _ name: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { Image(systemName: icon).font(.system(size: 15)).frame(width: 24) }
            .buttonStyle(CGButton(compact: true)).accessibilityLabel(name)
    }
    @ViewBuilder private func share(_ card: Card) -> some View {
        if let u = result.challengeURL {
            ShareLink(item: u, message: Text(String(format: "%.1f on %@. Beat it.", card.total, COURSE_INFO.first { $0.id == result.course }?.name ?? "Cold Gas"))) {
                Image(systemName: "square.and.arrow.up").font(.system(size: 15)).frame(width: 24)
            }.buttonStyle(CGButton(compact: true)).accessibilityLabel("Challenge a friend")
        }
    }
    private func facts(_ t: Telemetry) -> some View {
        let rows: [(String, String)] = [
            ("Sink", Fmt.rate(t.sink) + " " + Fmt.rateUnit),
            ("Tilt", String(format: "%.0f°", t.tiltDeg)),
            ("Wheels", t.wheelSpreadMs >= 1000 ? "—" : String(format: "%.0f ms apart", t.wheelSpreadMs)),
            ("Apex", Fmt.length(max(0, t.apex - SPEC.comHeight)) + " " + Fmt.lengthUnit),
            ("Damage", String(format: "%.0f%%", t.damage?.pct ?? 0)),
        ]
        return Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 6) {
            ForEach(stride(from: 0, to: rows.count, by: 2).map { $0 }, id: \.self) { i in
                GridRow {
                    fact(rows[i])
                    if i + 1 < rows.count { fact(rows[i + 1]) } else { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                }
            }
        }
    }
    private func fact(_ r: (String, String)) -> some View {
        HStack { Text(r.0).font(Theme.text(12)).foregroundStyle(Theme.ink2); Spacer(minLength: 8); Text(r.1).lineLimit(1).minimumScaleFactor(0.8).font(Theme.mono(12)).foregroundStyle(Theme.ink) }
            .accessibilityElement(children: .combine)
    }
}

let JUDGE_NAMES = ["engineer": "ENGINEER", "coordinator": "COORDINATOR", "designer": "DESIGNER"]

// MARK: - The controller

struct ControllerView: View {
    @ObservedObject var game = Game.shared
    var panel: Bool   // the Duo's lower panel (tabletop): the whole panel is the controller
    var body: some View {
        let air = game.hud.phase == 2 || (game.hud.phase == 1 && game.hud.released)
        // A controller or a keyboard in use hides the touch controls, as on the web; a finger on the glass brings them back.
        if game.hud.hardware {
            Color.clear.contentShape(Rectangle()).onTapGesture { Hardware.shared.note(touch: true) }
        } else if game.tier == "advanced" && air && game.hud.phase != 3 {
            NozzlePad().padding(panel ? 8 : 4)
        } else if game.oneThumb { ThumbPad(panel: panel) } else { ClassicPad(panel: panel) }
    }
}

/// One-thumb (src/onethumb.js): the whole pad is the control. Hold to climb, tap to let go, hold to land, slide to aim.
/// The touches themselves are ThumbSurfaceView's (Input/ControlSurface.swift).
struct ThumbPad: View {
    @ObservedObject var game = Game.shared
    var panel: Bool
    /// Its diameter over the scene (the camera keeps the car clear of it: CameraFraming).
    static func size(_ width: CGFloat) -> CGFloat { min(170, width * 0.42) }
    var body: some View {
        let h = game.hud
        let word: String = {
            switch h.stage {
            case "ledge": return game.controls.thumbDriving ? "Letting go" : "Tap · Let go"
            case "fly": return "Hold · Land"
            case "landed": return "Stopping"
            default: return "Hold · Climb"
            }
        }()
        ThumbSurface(panel: panel, word: word, aimLive: h.aimLive, hasMark: h.hasMark, markX: h.markX, markY: h.markY)
    }
}

/// Classic touch (src/input.js): the stick on the left, the pedals (ground) or LIFT / LAND (air) on the right.
/// The touches themselves are ClassicSurfaceView's.
struct ClassicPad: View {
    @ObservedObject var game = Game.shared
    var panel: Bool
    // Over the scene (the camera keeps the car clear of them: CameraFraming): the stick's square, the buttons' 2×2 square.
    static let unit: CGFloat = 112, margin: CGFloat = 10, stickSize = unit * 0.5 * 2.4, buttonsSize = unit * 0.62 * 2 + 10
    var body: some View {
        ClassicSurface(panel: panel, air: game.hud.phase == 2 || (game.hud.phase == 1 && game.hud.released))
    }
}
