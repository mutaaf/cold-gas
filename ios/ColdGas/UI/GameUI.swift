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
    enum Sheet: String, Identifiable { case board, settings, howTo; var id: String { rawValue } }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            switch game.screen {
            case .title: TitleView(open: { sheet = $0 }).frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
            case .run: RunView(layout: layout)
            case .results:
                if let r = game.result {
                    ResultsView(result: r, open: { sheet = $0 })
                        .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
                        .opacity(game.replaying ? 0 : 1).allowsHitTesting(!game.replaying)   // kept alive: the post and the judges' words stay
                    if game.replaying {
                        Button { game.stopWatching() } label: { Text("Back to the score") }
                            .buttonStyle(CGButton())
                            .frame(width: layout.controls.width, height: layout.controls.height, alignment: .bottom)
                            .offset(x: layout.controls.minX, y: layout.controls.minY - 16)
                    }
                }
            }
        }
        .ignoresSafeArea()
        .sheet(item: $sheet) { s in
            Group {
                switch s {
                case .board: BoardView(course: game.course)
                case .settings: SettingsView()
                case .howTo: HowToView()
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
            HUDView(compact: !rows && layout.controls.height < 520, cueLift: rows || layout.scene.width > layout.scene.height ? 0 : (game.tier == "advanced" && (game.hud.phase == 2 || game.hud.released) ? 400 : 196))
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
    @StateObject private var post = PostModel()
    @StateObject private var judges = JudgesModel()
    var body: some View {
        let card = result.card
        VStack {
            Spacer(minLength: 8)
            ViewThatFits(in: .vertical) {
                sheet(card)
                ScrollView { sheet(card) }.scrollBounceBehavior(.basedOnSize)
            }
            .glass(20)
            .frame(maxWidth: 480)
            .padding(.horizontal, 16).padding(.bottom, 16)
        }
        .onAppear { judges.ask(result) }
    }
    private func sheet(_ card: Card) -> some View {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(String(format: "%.1f", card.total)).font(Theme.mono(46, bold: true)).foregroundStyle(Theme.ink).monospacedDigit()
                        Text("/ 100").font(Theme.mono(14)).foregroundStyle(Theme.ink3)
                        Spacer()
                        Text(card.tier.uppercased()).font(Theme.text(11, .medium)).tracking(1.6).foregroundStyle(card.tier == "assist" ? Theme.ink2 : Theme.amber)
                            .padding(.horizontal, 10).padding(.vertical, 5).overlay(Capsule().strokeBorder(Theme.hair))
                    }
                    Text(card.verdict).font(Theme.text(17, .medium)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        ForEach(Array(card.judges.enumerated()), id: \.offset) { _, j in
                            VStack(spacing: 4) {
                                Text(JUDGE_NAMES[j.id] ?? j.id).font(Theme.text(10, .medium)).tracking(0.8).foregroundStyle(Theme.ink3).lineLimit(1).minimumScaleFactor(0.7)
                                Text(String(format: "%.1f", j.score)).font(Theme.mono(22)).foregroundStyle(Theme.ink)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hair))
                        }
                    }
                    if let m = Records.shared.lastRecord, let medal = m.earned {
                        Text("\(medal.label) medal\(m.isNew ? " · new" : "")").font(Theme.text(13, .medium)).foregroundStyle(Theme.amber)
                    }
                    if let d = result.dailyLine { Text(d).font(Theme.text(13)).foregroundStyle(result.dailyOK ? Theme.ok : Theme.ink2).fixedSize(horizontal: false, vertical: true) }
                    facts(result.telemetry)
                    JudgesWordsView(result: result, model: judges)
                    PostRow(result: result, post: post)
                    VStack(spacing: 10) {
                        Button { game.retry() } label: { Text("Fly again").frame(maxWidth: .infinity) }.buttonStyle(CGButton(primary: true))
                        HStack(spacing: 8) {
                            Button { game.watch() } label: { Text("Watch it").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                            if let u = result.challengeURL {
                                ShareLink(item: u, message: Text(String(format: "%.1f on %@. Beat it.", card.total, COURSE_INFO.first { $0.id == result.course }?.name ?? "Cold Gas"))) {
                                    Image(systemName: "square.and.arrow.up").font(.system(size: 15)).frame(width: 24)
                                }.buttonStyle(CGButton(compact: true)).accessibilityLabel("Challenge a friend")
                            }
                            Button { open(.board) } label: { Text("Board").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                            Button { game.home() } label: { Text("Home").frame(maxWidth: .infinity) }.buttonStyle(CGButton(compact: true))
                        }
                    }
                }
                .padding(18)
    }
    private func facts(_ t: Telemetry) -> some View {
        let rows: [(String, String)] = [
            ("Sink", Fmt.rate(t.sink) + " " + Fmt.rateUnit),
            ("Tilt", String(format: "%.0f°", t.tiltDeg)),
            ("Wheels", t.wheelSpreadMs >= 1000 ? "—" : String(format: "%.0f ms apart", t.wheelSpreadMs)),
            ("Apex", Fmt.length(max(0, t.apex - SPEC.comHeight)) + " " + Fmt.lengthUnit),
            ("Damage", String(format: "%.0f%%", t.damage?.pct ?? 0)),
        ]
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 6) {
            ForEach(rows, id: \.0) { r in
                HStack { Text(r.0).font(Theme.text(12)).foregroundStyle(Theme.ink3); Spacer(); Text(r.1).font(Theme.mono(12)).foregroundStyle(Theme.ink2) }
            }
        }
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
struct ThumbPad: View {
    @ObservedObject var game = Game.shared
    var panel: Bool
    @State private var down = false
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
        GeometryReader { geo in
            let size = panel ? min(geo.size.width, geo.size.height) * 0.78 : min(170, geo.size.width * 0.42)
            ZStack {
                Circle().fill(down ? Theme.ink.opacity(0.16) : Theme.glass)
                    .overlay(Circle().strokeBorder(down ? Theme.ink.opacity(0.7) : Theme.hair, lineWidth: down ? 2 : 1))
                    .background(.ultraThinMaterial.opacity(0.4), in: Circle())
                if h.aimLive {
                    Circle().strokeBorder(Theme.ice.opacity(0.4), lineWidth: 1).frame(width: size * 0.56, height: size * 0.56)
                }
                if h.hasMark {   // the sight (src/thumb-aim.js): where the mark is from the predicted touchdown; slide onto it
                    Circle().fill(Theme.ice).frame(width: 8, height: 8).offset(x: h.markX, y: h.markY)
                }
                Text(word.uppercased()).font(Theme.text(panel ? 15 : 12, .medium)).tracking(1.6).foregroundStyle(Theme.ink)
            }
            .frame(width: size, height: size)
            .contentShape(Circle())
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { v in
                    if !down { down = true; game.controls.thumbDown(); UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.5) }
                    game.controls.thumbMove(dx: v.translation.width, dy: -v.translation.height)
                }
                .onEnded { _ in down = false; game.controls.thumbUp() })
            .position(x: panel ? geo.size.width / 2 : geo.size.width - size / 2 - 8, y: panel ? geo.size.height / 2 : geo.size.height - size / 2 - 8)
            .accessibilityLabel("Thrust pad")
            .accessibilityHint(word)
            .accessibilityAddTraits(.allowsDirectInteraction)
        }
    }
}

/// Classic touch (src/input.js): the stick on the left, the pedals (ground) or LIFT / LAND (air) on the right.
struct ClassicPad: View {
    @ObservedObject var game = Game.shared
    var panel: Bool
    var body: some View {
        let air = game.hud.phase == 2 || (game.hud.phase == 1 && game.hud.released)
        GeometryReader { geo in
            let unit = panel ? min(geo.size.height * 0.42, 150.0) : 112.0
            HStack(alignment: .bottom) {
                Stick(radius: unit * 0.5)
                Spacer()
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        PadButton(label: "LIFT", key: .lift, size: unit * 0.62)
                        PadButton(label: "LAND", key: .land, size: unit * 0.62)
                    }
                    HStack(spacing: 10) {
                        PadButton(label: air ? "BRAKE" : "BRAKE", key: .brake, size: unit * 0.62)
                        PadButton(label: air ? "BOOST" : "GO", key: .go, size: unit * 0.62)
                    }
                }
            }
            .padding(panel ? 20 : 10)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
    }
}

struct Stick: View {
    @ObservedObject var game = Game.shared
    let radius: CGFloat
    @State private var knob = CGSize.zero
    var body: some View {
        ZStack {
            Circle().fill(Theme.glass).overlay(Circle().strokeBorder(Theme.hair)).background(.ultraThinMaterial.opacity(0.4), in: Circle())
            Circle().fill(Theme.ink.opacity(0.85)).frame(width: radius * 0.7, height: radius * 0.7).offset(knob)
        }
        .frame(width: radius * 2.4, height: radius * 2.4)
        .contentShape(Circle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in
                var dx = v.location.x - radius * 1.2, dy = v.location.y - radius * 1.2
                let l = (dx * dx + dy * dy).squareRoot()
                if l > radius { dx *= radius / l; dy *= radius / l }
                knob = CGSize(width: dx, height: dy)
                game.controls.stick(x: Double(dx / radius), y: Double(dy / radius))
            }
            .onEnded { _ in knob = .zero; game.controls.stick(x: 0, y: 0) })
        .accessibilityLabel("Steering stick")
        .accessibilityAddTraits(.allowsDirectInteraction)
    }
}

struct PadButton: View {
    @ObservedObject var game = Game.shared
    let label: String
    let key: Controls.Key
    let size: CGFloat
    @State private var on = false
    var body: some View {
        Text(label).font(Theme.text(12, .medium)).tracking(1.2).foregroundStyle(on ? Theme.bg : Theme.ink)
            .frame(width: size, height: size)
            .background(on ? Theme.ink : Theme.glass, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { _ in if !on { on = true; game.controls.press(key, true); UISelectionFeedbackGenerator().selectionChanged() } }
                .onEnded { _ in on = false; game.controls.press(key, false) })
            .accessibilityLabel(label)
            .accessibilityAddTraits(.allowsDirectInteraction)
    }
}
