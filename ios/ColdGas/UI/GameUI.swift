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
    /// The fold's band (the Duo), in the same coordinates; nil on a screen that doesn't fold.
    @Published var fold: CGRect?
    /// A vertical fold (the Duo open) across `rect`, as an x range in that rect's own coordinates: what sits centred over
    /// it moves off the crease.
    func crease(in rect: CGRect) -> ClosedRange<CGFloat>? {
        guard spread != .rows, let f = fold, f.height > f.width, f.minX > rect.minX, f.maxX < rect.maxX else { return nil }
        return (f.minX - rect.minX)...(f.maxX - rect.minX)
    }
}

struct RootUI: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    @ObservedObject var hud = HudStore.shared
    @State private var sheet: Sheet? = RootUI.launchSheet
    /// DEBUG `-sheet board|settings|howTo|practice`: that sheet open at launch (the shots).
    private static var launchSheet: Sheet? {
        #if DEBUG
        return Launch.value("-sheet").flatMap(Sheet.init(rawValue:))
        #else
        return nil
        #endif
    }
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
            case .title: TitleView(crease: layout.crease(in: layout.controls), open: { sheet = $0 }).frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
            case .run: RunView(layout: layout)
            case .drive: DriveView(layout: layout)
            case .results:
                if let r = game.result {
                    if !game.replaying {   // the post and the judges' words live on the result, so they survive watching it back
                        ResultsView(result: r, open: { sheet = $0 }, post: r.post, judges: r.judges)
                            .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
                    } else {
                        Button { game.stopWatching() } label: { Label("Back to the score", systemImage: "chevron.down") }
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
            // The HUD layout editor (0221), from Settings → Controls or the pause sheet: over everything, the run under it paused.
            if let t = hud.editing {
                HudEditorView(layout: layout, tier: t) { withAnimation(.easeOut(duration: 0.2)) { hud.editing = nil } }
                    .id("\(t.rawValue)")
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
let TIER_INFO: [(id: String, name: String, mult: String, line: String)] = [
    ("assist", "Assist", "", "The flight computer rolls you out and brakes. One thumb on the Show and the Wall."),
    ("pro", "Pro", "×1.08", "You fly the roll-out and the brake yourself. Scores ×1.08."),
    ("advanced", "Advanced", "×1.15", "All ten valves by hand, off the Wall. Scores ×1.15."),
]

/// The title (0230): a playbill over the night stage. The event is the headline, set big; the other two sit small beside
/// it in the list, a tap away. Then the tier, today's objective, and one button: Fly. Roam and Free Drive are words under
/// it; the drills, the board, how to play and the settings are four glyphs in the corner. One entrance, top to bottom.
struct TitleView: View {
    @ObservedObject var game = Game.shared
    /// A vertical fold across the panel (the Duo open), in its own x: the two columns sit either side of it.
    var crease: ClosedRange<CGFloat>? = nil
    var open: (RootUI.Sheet) -> Void
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        GeometryReader { g in
            let wide = g.size.width > g.size.height * 1.15 && g.size.width >= 560
            let short = g.size.height < 460
            ZStack(alignment: .topTrailing) {
                // The scene stays the picture: a scrim only where the words are.
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: Theme.bg.opacity(0.6), location: 0.3),
                                       .init(color: Theme.bg.opacity(0.9), location: 1)], startPoint: .top, endPoint: .bottom)
                    .frame(height: g.size.height * (wide ? 0.75 : 0.62)).frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.horizontal, -400).padding(.bottom, -120)   // past the panel's edges: a scrim, never a box
                    .allowsHitTesting(false).accessibilityHidden(true)
                if game.firstRun {
                    // 0249: a tap anywhere on the title flies the first jump; the words and buttons sit over it.
                    Color.clear.contentShape(Rectangle()).onTapGesture { game.play() }
                        .accessibilityHidden(true)
                    firstBody(short: short)
                } else if wide { wideBody(g.size, short: short) } else { tallBody(short: short) }
                utilities.padding(.top, 8).padding(.trailing, 10).enter(shown, still, 0)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .onAppear { shown = false; DispatchQueue.main.async { shown = true }; Usage.shared.flush() }
    }

    // An upright phone, the Duo closed: one column at the bottom, the thumb's end of the screen.
    private func tallBody(short: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 56)
            wordmark.enter(shown, still, 0.05)
            courses(big: short ? 28 : 34).padding(.top, 8).enter(shown, still, 0.12)
            tiers.padding(.top, 12).enter(shown, still, 0.2)
            daily.padding(.top, 6).enter(shown, still, 0.24)
            fly.padding(.top, 18).enter(shown, still, 0.3)
            more.padding(.top, 4).enter(shown, still, 0.36)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, 20).padding(.bottom, short ? 8 : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    // The first run (0249): the Show, one line, one Fly. The rest are there but quiet, and the car waits on the mark.
    private func firstBody(short: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 56)
            wordmark.enter(shown, still, 0.05)
            HStack(alignment: .center, spacing: 10) {
                Tick(on: true, length: (short ? 28 : 34) * 0.8)
                Text("THE SHOW").font(Theme.marquee(short ? 28 : 34)).tracking(1).foregroundStyle(Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            .padding(.leading, -12).padding(.top, 8).enter(shown, still, 0.12)
            .accessibilityElement(children: .combine).accessibilityLabel("The Show")
            Text("Your first jump. Tap anywhere to fly.")
                .font(Theme.text(14, .medium)).foregroundStyle(Theme.ink2)
                .padding(.top, 6).enter(shown, still, 0.2)
                .accessibilityIdentifier("first-run")
            fly.padding(.top, 18).enter(shown, still, 0.26)
            more.padding(.top, 4).opacity(0.7).enter(shown, still, 0.32)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, 24).padding(.bottom, short ? 8 : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    // On its side, tabletop's lower panel, the Duo open: the events on the left, the run's choices and Fly on the right
    // (either side of the crease when there is one).
    private func wideBody(_ size: CGSize, short: Bool) -> some View {
        let gap: CGFloat = crease.map { $0.upperBound - $0.lowerBound + 40 } ?? 32
        let left = crease.map { $0.lowerBound - 20 - 24 } ?? (size.width - 48 - gap) * 0.5
        return HStack(alignment: .bottom, spacing: gap) {
            VStack(alignment: .leading, spacing: 0) {
                wordmark.enter(shown, still, 0.05)
                courses(big: short ? 26 : 32).padding(.top, 6).enter(shown, still, 0.12)
            }
            .frame(width: max(220, left), alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                tiers.enter(shown, still, 0.2)
                daily.padding(.top, 4).enter(shown, still, 0.24)
                fly.padding(.top, short ? 10 : 16).enter(shown, still, 0.3)
                more.padding(.top, 2).enter(shown, still, 0.36)
            }
            .frame(maxWidth: 380, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24).padding(.bottom, short ? 6 : 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    private var wordmark: some View {
        Text("COLD GAS").font(Theme.marquee(11, .footnote)).tracking(7).foregroundStyle(Theme.ink2)
            .accessibilityAddTraits(.isHeader)
    }

    /// The three events, the chosen one as the headline. A tap on another makes it the headline.
    private func courses(big: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(COURSE_INFO, id: \.id) { c in
                let on = game.course == c.id
                Button {
                    guard !on else { return }
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(still ? nil : .snappy(duration: 0.32)) { game.course = c.id }
                } label: {
                    HStack(alignment: .center, spacing: 10) {
                        Tick(on: on, length: big * 0.8)
                        Text(c.name.uppercased())
                            .font(Theme.marquee(big)).tracking(on ? 1 : 3)
                            .foregroundStyle(on ? Theme.ink : Theme.ink2)
                            .lineLimit(1).minimumScaleFactor(0.6)
                            .scaleEffect(on ? 1 : 0.5, anchor: .leading)
                            .frame(height: on ? big * 1.35 : 40, alignment: .leading)
                        Spacer(minLength: 8)
                        if on, let best = Records.shared.best(c.id) {
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(String(format: "%.1f", best)).font(Theme.mono(18)).foregroundStyle(Theme.ink).monospacedDigit()
                                Text("BEST").font(Theme.text(9, .medium)).tracking(1.6).foregroundStyle(Theme.ink3)
                            }
                            .transition(.opacity)
                            .accessibilityElement(children: .combine).accessibilityLabel(String(format: "Your best %.1f", best))
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, -12)
                .accessibilityLabel(c.name)
                .accessibilityHint(c.line)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// Assist, Pro, Advanced: words, the chosen one lit and underlined in its colour. Where the row can't hold the
    /// multipliers (a narrow column), the names alone; a name never breaks.
    private var tiers: some View {
        ViewThatFits(in: .horizontal) { tierRow(mult: true); tierRow(mult: false) }
    }
    private func tierRow(mult: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(TIER_INFO, id: \.id) { t in
                let on = game.tier == t.id
                let mark = t.id == "pro" ? Theme.amber : t.id == "advanced" ? Theme.signal : Theme.ink
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(still ? nil : .easeOut(duration: 0.2)) { game.tier = t.id }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(t.name.uppercased()).font(Theme.text(12, .semibold)).tracking(1.6).lineLimit(1).fixedSize()
                        if mult && !t.mult.isEmpty { Text(t.mult).font(Theme.mono(10)).opacity(0.8).fixedSize() }
                    }
                    .foregroundStyle(on ? Theme.ink : Theme.ink3)
                    .padding(.horizontal, 8).frame(minHeight: 44)
                    .overlay(alignment: .bottom) { Capsule().fill(mark).frame(height: 2).padding(.horizontal, 8).padding(.bottom, 8).opacity(on ? 1 : 0) }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t.name)
                .accessibilityHint(t.line)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.leading, -8)
    }

    /// Today's objective in a line (and the streak), green once it's done.
    private var daily: some View {
        let o = Daily.objectiveFor(SaveStore.nowMs), streak = SaveStore.shared.streakNow()
        let goal = o.goal(SaveStore.shared.units), course = Daily.courseName(o.course)
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: streak.doneToday ? "checkmark" : "calendar").font(.system(size: 10, weight: .semibold))
            Text("\(goal) · \(course)\(streak.streak > 1 ? " · \(streak.streak) days" : "")")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(Theme.text(12, .medium)).foregroundStyle(streak.doneToday ? Theme.ok : Theme.ink2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Today\u{2019}s jump: \(goal) on \(course)\(streak.doneToday ? ", done" : "")\(streak.streak > 1 ? ", \(streak.streak) day streak" : "")")
    }

    private var fly: some View {
        Button { game.play() } label: { Text("Fly") }
            .buttonStyle(MarqueeButton())
            .accessibilityIdentifier("play")
            .accessibilityLabel("Fly \(COURSE_INFO.first { $0.id == game.course }?.name ?? "")")
    }

    /// The unscored ways to drive: Roam (0220) this course's set and the world past it; Free Drive from the apron.
    private var more: some View {
        HStack(spacing: 6) {
            Button { game.startDrive(roam: game.course); UISelectionFeedbackGenerator().selectionChanged() } label: {
                Label("Roam", systemImage: "car.side").labelStyle(.titleAndIcon)
            }
            .buttonStyle(QuietButton())
            .accessibilityIdentifier("roam")
            .accessibilityLabel("Roam \(COURSE_INFO.first { $0.id == game.course }?.name ?? "")")
            .accessibilityHint("Drive round this course's set and on into the world. Not scored.")
            Button { game.startDrive(); UISelectionFeedbackGenerator().selectionChanged() } label: {
                Label("Free Drive", systemImage: "globe.americas").labelStyle(.titleAndIcon)
            }
            .buttonStyle(QuietButton())
            .accessibilityIdentifier("freedrive")
            .accessibilityHint("Drive off the apron into a world with no edge. Not scored.")
        }
        .padding(.leading, -10)
    }

    /// Practice, the board, how to play, settings: four glyphs in one hairline capsule.
    private var utilities: some View {
        HStack(spacing: 0) {
            glyph("scope", "Practice") { open(.practice) }
            glyph("list.number", "Board") { open(.board) }
            glyph("questionmark", "How to play") { open(.howTo) }
            glyph("gearshape", "Settings") { open(.settings) }
        }
        .padding(.horizontal, 2)
        .background(Theme.glass, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.hair2, lineWidth: 1))
    }
    private func glyph(_ name: String, _ label: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: name).font(.system(size: 15, weight: .regular)).foregroundStyle(Theme.ink2)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}

/// The title's entrance: each part rises into place a beat after the one above it. Reduce Motion: a plain fade.
private struct Enter: ViewModifier {
    let shown: Bool, still: Bool, delay: Double
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || still ? 0 : 14)
            .animation(still ? .easeOut(duration: 0.2) : .spring(duration: 0.55, bounce: 0.12).delay(delay), value: shown)
    }
}
extension View {
    fileprivate func enter(_ shown: Bool, _ still: Bool, _ delay: Double) -> some View { modifier(Enter(shown: shown, still: still, delay: delay)) }
}

// MARK: - The run

struct RunView: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    @ObservedObject var hud = HudStore.shared
    /// The cue line sits above whatever the deck puts across the bottom middle of the scene.
    private var cueLift: CGFloat {
        let c = layout.controls
        if game.oneThumb && !game.hud.hardware { return layout.scene.width > layout.scene.height ? 0 : 196 }
        let d = DeckGeometry.layout(c.size)
        let valves = game.tier == "advanced" && game.hud.touchPhase == .air
        // Only what crosses the middle third of the screen pushes the cue up (side clusters leave it be).
        let mid = CGRect(x: c.width / 3, y: 0, width: c.width / 3, height: c.height)
        var top = c.height
        for r in (valves ? d.valveCovers : d.covers) + (d.strip.map { [$0] } ?? []) where r.cgRect.intersects(mid) { top = min(top, CGFloat(r.y)) }
        return max(0, c.height - top + 4)
    }
    /// Advanced's valve deck split to the screen's sides (a phone sideways, the Duo open): its halves own both top corners,
    /// so the HUD steps into the free middle.
    private var hudCentred: Bool {
        guard layout.spread != .rows, game.tier == "advanced", game.hud.touchPhase == .air, !game.hud.hardware else { return false }
        let d = DeckGeometry.layout(layout.controls.size)
        return d.valves.count == 2 && d.form != .tablet
    }
    /// Advanced in the air on an upright phone: the valve deck (the whole car) fills the bottom and the camera holds the car
    /// just above it, so a cue lifted over the deck would sit on the car. It goes under the gas bar instead.
    private var cueTop: Bool {
        guard layout.spread != .rows, game.tier == "advanced", game.hud.touchPhase == .air, !game.hud.hardware else { return false }
        let d = DeckGeometry.layout(layout.controls.size)
        return d.valves.count == 1 && layout.controls.height > layout.controls.width
    }
    var body: some View {
        let rows = layout.spread == .rows
        let sceneSafe = CGRect(x: layout.scene.minX + layout.safe.leading, y: layout.scene.minY + layout.safe.top,
                               width: layout.scene.width - layout.safe.leading - (rows ? 0 : layout.safe.trailing),
                               height: layout.scene.height - layout.safe.top - (rows ? 0 : layout.safe.bottom))
        ZStack(alignment: .topLeading) {
            HUDView(compact: !rows && layout.controls.height < 520, cueLift: rows ? 0 : cueLift, centred: hudCentred,
                    crease: layout.crease(in: sceneSafe), cueTop: cueTop)
                .frame(width: sceneSafe.width, height: sceneSafe.height).offset(x: sceneSafe.minX, y: sceneSafe.minY)
            ControllerView(panel: rows, layoutKey: "\(layout.spread.rawValue) \(Int(layout.controls.width))x\(Int(layout.controls.height)) \(hud.revision)")
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
    var centred = false        // the pause and the readouts in the top middle (Advanced's split valve deck has the corners)
    var crease: ClosedRange<CGFloat>? = nil   // a vertical fold across the HUD (x in its frame): nothing centred sits on it
    var cueTop = false         // the cue under the gas bar, not above the controls
    var body: some View {
        let h = game.hud
        VStack(spacing: 0) {
            if centred, let c = crease {
                // The Duo open: the pause just left of the crease, the readouts and the gas just right of it.
                HStack(alignment: .top, spacing: 0) {
                    pause.frame(width: max(40, c.lowerBound - 12 - 10), alignment: .trailing)
                    Spacer().frame(width: c.upperBound - c.lowerBound + 20)
                    VStack(alignment: .leading, spacing: 8) {
                        readouts(h)
                        gasBar(h.gas).frame(width: compact ? 120 : 160)
                    }
                    Spacer(minLength: 0)
                }
            } else {
            HStack(alignment: .top) {
                if centred { Spacer() }
                pause
                if centred { Spacer().frame(width: 10) } else { Spacer() }
                readouts(h)
                if centred { Spacer() }
            }
            HStack {
                Spacer()
                gasBar(h.gas).frame(width: compact ? 120 : 160)
                if centred { Spacer() }
            }.padding(.top, 8)
            }
            if let c = crease {
                // The Duo open: a line of text can't be read across the crease, and the bottom belongs to the controls.
                // The cue sits under the readouts, starting just right of the crease.
                HStack(spacing: 0) {
                    Spacer().frame(width: max(0, c.upperBound + 10 - 12))
                    cue(h.cue)
                    Spacer(minLength: 0)
                }.padding(.top, 10)
                Spacer()
            } else if cueTop {
                cue(h.cue).padding(.top, 10)
                Spacer()
            } else {
                Spacer()
                cue(h.cue).padding(.bottom, 8 + cueLift)
            }
        }
        .padding(12)
        .animation(.easeOut(duration: 0.25), value: h.cue)
        .animation(.easeOut(duration: 0.25), value: h.guide)
    }
    private var pause: some View {
        Button { game.paused = true; UISelectionFeedbackGenerator().selectionChanged() } label: {
            Image(systemName: "pause.fill").font(.system(size: 13)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40).glass(20)
        }.buttonStyle(.plain).accessibilityLabel("Pause")
    }
    private func readouts(_ h: HudState) -> some View {
        HStack(spacing: 16) {
            readout("SPEED", Fmt.speed(h.speed), Fmt.speedUnit)
            readout("ALT", Fmt.length(h.alt), Fmt.lengthUnit)
            if h.phase == 2 { readout("SINK", Fmt.rate(h.sink), Fmt.rateUnit, color: [Theme.ink, Theme.amber, Theme.hot][h.sinkBand]) }
        }
        .padding(.horizontal, 14).padding(.vertical, 8).glass(12)
    }
    @ViewBuilder private func cue(_ s: String) -> some View {
        if game.guided {
            if let g = game.hud.guide { GuideHint(text: g, skip: { game.skipHints() }) }
        } else if !s.isEmpty {
            Text(s).font(Theme.text(compact ? 13 : 15, .medium)).foregroundStyle(Theme.ink)
                .padding(.horizontal, 14).padding(.vertical, 8).glass(18)
                .transition(.opacity).id(s)
                .accessibilityAddTraits(.updatesFrequently)
        }
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

/// The guided first jump's hint (0249): one line, set bigger than the cue, and a quiet way out. It goes the moment the
/// thing it asks for is done.
struct GuideHint: View {
    let text: String
    let skip: () -> Void
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var breathe = false
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.signal).frame(width: 7, height: 7)
                .scaleEffect(breathe && !still ? 1.35 : 1).opacity(breathe && !still ? 0.55 : 1)
                .animation(still ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: breathe)
                .accessibilityHidden(true)
            Text(text).font(Theme.text(17, .semibold)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("guide")
            Rectangle().fill(Theme.hair2).frame(width: 1, height: 22).accessibilityHidden(true)
            Button("I\u{2019}ve got it", action: skip)
                .font(Theme.text(12, .medium)).foregroundStyle(Theme.ink2)
                .frame(minHeight: 44).contentShape(Rectangle())
                .accessibilityIdentifier("skip-hints")
                .accessibilityHint("No more hints")
        }
        .padding(.leading, 16).padding(.trailing, 12).padding(.vertical, 4).glass(18)
        .transition(.opacity).id(text)
        .onAppear { breathe = true }
        .accessibilityElement(children: .contain)
    }
}

/// The pause (0230): the run dims and holds; Resume is the one big thing, the rest are words under it. No heading: the held
/// frame says paused.
struct PauseView: View {
    @ObservedObject var game = Game.shared
    var body: some View {
        ZStack {
            Color.black.opacity(0.78).accessibilityHidden(true)
            VStack(spacing: 14) {
                Button("Resume") { game.paused = false }.buttonStyle(MarqueeButton()).frame(maxWidth: 280)
                    .accessibilityLabel("Resume")
                HStack(spacing: 4) {
                    Button { game.retry() } label: { Label("Restart", systemImage: "arrow.counterclockwise") }.accessibilityLabel("Restart")
                    Button { HudStore.shared.editing = DeckGeometry.tier } label: { Label("Edit controls", systemImage: "rectangle.and.hand.point.up.left") }
                        .accessibilityLabel("Edit controls").accessibilityHint("Move, size and fade the touch controls")
                    Button { game.home() } label: { Label("Home", systemImage: "house") }.accessibilityLabel("Home")
                }
                .buttonStyle(QuietButton(color: Theme.ink))
                .labelStyle(.titleOnly)
            }
            .padding(20)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
            .accessibilityLabel("Paused")
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
        if result.firstLanding && !moreShown {
            FirstLandingView(result: result, more: { withAnimation(.easeOut(duration: 0.2)) { moreShown = true } }, share: AnyView(share(result.card, 54)))
                .onAppear { Ready.mark("first-landing"); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { Usage.shared.flush() } }
        } else if result.firstRun && !celebrated(result.card) && result.drill == nil && !moreShown {
            firstWreck
        } else { sheetBody }
    }
    @State private var moreShown = false
    /// A wreck on the first run is not a failure screen (0249): one line of what to do, and Fly again.
    private var firstWreck: some View {
        let c = result.coach.first
        let line = c.map { $0.fix.isEmpty ? $0.title : $0.fix } ?? "Hold the pad sooner to land"
        return VStack(alignment: .leading, spacing: 14) {
            Text("NOT THIS TIME").font(Theme.marquee(13, .headline)).tracking(2).foregroundStyle(Theme.ink2)
            Text(line).font(Theme.text(18, .semibold)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("first-wreck")
            Button { game.retry() } label: { Text("Fly again") }
                .buttonStyle(MarqueeButton(height: 54)).accessibilityIdentifier("again").accessibilityLabel("Fly again")
            HStack {
                Button { withAnimation(.easeOut(duration: 0.2)) { moreShown = true } } label: { Text("The score") }
                Spacer()
                Button { game.home() } label: { Text("Home") }
            }
            .buttonStyle(QuietButton())
        }
        .padding(20).glass(20).frame(maxWidth: 480)
        .padding(.horizontal, 16).padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .onAppear { Ready.mark("results") }
    }
    private var sheetBody: some View {
        let card = result.card
        return GeometryReader { g in
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
        .onAppear {
            if result.drill == nil { judges.ask(result) }
            Ready.mark("results")
            // The funnel's batch goes once the sheet has settled (0246), never while the judges' words are arriving at once.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { Usage.shared.flush() }
        }
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
                                Text(c.title).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                                Text(c.fix.isEmpty ? c.detail : c.fix).font(Theme.text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(c.id == "clean" ? "Next run" : "What cost you"): \(c.title). \(c.fix.isEmpty ? c.detail : c.fix)")
                    }
                    Accordion(title: "The numbers", summary: numbersLine(result.telemetry), isOpen: $numbersOpen, show: .summary) { facts(result.telemetry) }.id("numbers")
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
            Text(card.verdict.uppercased()).font(Theme.marquee(15, .headline)).tracking(1.2).foregroundStyle(ink).fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(card.verdict)
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
    /// After a landing (0258, the web's 0257): Next jump is the tall button, then Beat <score> and Share side by side, then
    /// Post, then the quiet words under a hairline. After a wreck: Fly again, then Share. A drill: Again.
    private func actions(_ card: Card, short: Bool) -> some View {
        let h: CGFloat = short ? 48 : 54
        let landed = result.drill == nil && celebrated(card)
        return VStack(alignment: .leading, spacing: short ? 6 : 10) {
            if landed {
                let next = COURSE_INFO.first { $0.id == Game.nextCourse(after: result.course) }?.name ?? ""
                Button { game.next() } label: { Text("Next \u{00B7} \(next)") }
                    .buttonStyle(MarqueeButton(height: h))
                    .accessibilityIdentifier("next")
                    .accessibilityLabel("Next jump: \(next)")
                HStack(spacing: 8) {
                    Button { game.retry() } label: { Text(String(format: "Beat %.1f", card.total)).frame(maxWidth: .infinity) }
                        .buttonStyle(MarqueeButton(height: h, hollow: true))
                        .accessibilityIdentifier("beat")
                        .accessibilityLabel(String(format: "Fly again: beat %.1f", card.total))
                    share(card, h)
                }
            } else {
                Button { game.retry() } label: { Text(result.drill == nil ? "Fly again" : "Again") }
                    .buttonStyle(MarqueeButton(height: h))
                    .accessibilityIdentifier("again")
                    .accessibilityLabel(result.drill == nil ? "Fly again" : "Again")
                if result.drill == nil { share(card, h) }
            }
            // Post (0258): below the next thing to do, never above it.
            PostRow(result: result, post: post)
            HStack(spacing: 0) {
                quiet("play.rectangle", "Watch it", short) { game.watch() }
                Spacer(minLength: 0)
                // Roam (0220): off the card and onto the set, unscored.
                if result.drill == nil {
                    quiet("car.side", "Roam", short) { game.startDrive(roam: result.course) }
                        .accessibilityIdentifier("roam-results").accessibilityHint("Drive round the set, unscored.")
                    Spacer(minLength: 0)
                }
                quiet("list.number", "Board", short) { open(.board) }
                Spacer(minLength: 0)
                quiet("house", "Home", short) { game.home() }
            }
            .overlay(alignment: .top) { Rectangle().fill(Theme.hair2).frame(height: 1) }
        }
    }
    /// A secondary action: its icon and its name (only the icon on a short screen, the name still read out).
    private func quiet(_ icon: String, _ name: String, _ short: Bool, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            if short { Image(systemName: icon).font(.system(size: 15)) } else { Label(name, systemImage: icon).font(Theme.text(13, .medium)) }
        }
        .buttonStyle(QuietButton()).accessibilityLabel(name)
    }
    @ViewBuilder private func share(_ card: Card, _ height: CGFloat) -> some View {
        if let u = result.challengeURL {
            ShareLink(item: u, message: Text(String(format: "%.1f on %@. Beat it.", card.total, COURSE_INFO.first { $0.id == result.course }?.name ?? "Cold Gas"))) {
                Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
            }
            .buttonStyle(MarqueeButton(height: height, hollow: true))
            .accessibilityIdentifier("share").accessibilityLabel("Share").accessibilityHint("Send a friend this jump to beat")
            .simultaneousGesture(TapGesture().onEnded { Usage.shared.track("share_tap", ["course": .text(result.course)]) })
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
    /// The fold layout's shape, so the deck re-lays itself out when it changes (DeckGeometry holds the numbers).
    var layoutKey: String
    var body: some View {
        let h = game.hud
        // A controller or a keyboard in use hides the touch controls, as on the web; a finger on the glass brings them back.
        if h.hardware {
            Color.clear.contentShape(Rectangle()).onTapGesture { Hardware.shared.note(touch: true) }
        } else if game.tier == "advanced" && h.touchPhase == .air {
            // main.js: off the Wall (or flying) on Advanced, the valve deck replaces the stick and the buttons.
            let course = game.live?.run.course ?? game.course
            ZStack {
                DeckBackdrop(names: Deck.stripNames(course: course), at: Deck.stripIndex(.air, course: course, ledge: false), layoutKey: layoutKey)
                NozzlePad(layoutKey: layoutKey)
            }
        } else if game.oneThumb { ThumbPad(panel: panel) } else { ClassicPad(layoutKey: layoutKey) }
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

/// Classic touch (src/input.js), as the flight deck (Input/FlightDeck.swift): the stick under the left thumb, the fan
/// of what this moment uses under the right.
struct ClassicPad: View {
    @ObservedObject var game = Game.shared
    var layoutKey: String
    var body: some View {
        let h = game.hud
        let course = game.live?.run.course ?? game.course
        let show = DeckShow(
            buttons: Deck.buttons(h.touchPhase, assist: game.tier == "assist", course: course, ledge: h.ledge, rowDone: h.rowDone),
            stickLabel: Deck.stickLabel(h.touchPhase), hint: h.hint, gas: (h.gas * 50).rounded() / 50,
            strip: Deck.stripIndex(h.touchPhase, course: course, ledge: h.ledge), stripNames: Deck.stripNames(course: course))
        FlightDeck(show: show, layoutKey: layoutKey)
    }
}

// MARK: - The first landing (0249)

/// The payoff for a newcomer: the verdict set big, the score counting up, a haptic swell of its own (HapticPlayer's
/// `.firstLanding`) and a three-note sting; then Next and Beat right there. No post form, no prompt, no ad, nothing over it.
/// The judges and the numbers are one tap down.
struct FirstLandingView: View {
    @ObservedObject var game = Game.shared
    let result: RunResult
    var more: () -> Void
    var share: AnyView
    @State private var shownScore = 0.0
    @State private var up = false
    @Environment(\.accessibilityReduceMotion) private var still
    var body: some View {
        let card = result.card
        let next = COURSE_INFO.first { $0.id == Game.nextCourse(after: result.course) }?.name ?? ""
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 24)
            Text("YOUR FIRST LANDING").font(Theme.marquee(11, .footnote)).tracking(5).foregroundStyle(Theme.ink2)
                .opacity(up ? 1 : 0).offset(y: up || still ? 0 : 10)
                .animation(still ? .easeOut(duration: 0.2) : .spring(duration: 0.5, bounce: 0.1), value: up)
            Text(card.verdict.uppercased()).font(Theme.marquee(30, .largeTitle)).tracking(1).foregroundStyle(Theme.ink)
                .lineLimit(2).minimumScaleFactor(0.6).padding(.top, 8)
                .opacity(up ? 1 : 0).offset(y: up || still ? 0 : 14)
                .animation(still ? .easeOut(duration: 0.2) : .spring(duration: 0.55, bounce: 0.12).delay(0.08), value: up)
                .accessibilityIdentifier("first-landing")
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(String(format: "%.1f", shownScore)).font(Theme.mono(56, bold: true)).foregroundStyle(Theme.ink).monospacedDigit()
                    .contentTransition(.numericText(value: shownScore))
                Text("/ 100").font(Theme.mono(15)).foregroundStyle(Theme.ink3)
            }
            .padding(.top, 2)
            .overlay(alignment: .bottomLeading) { Capsule().fill(Theme.signal).frame(width: up ? 56 : 0, height: 2).offset(y: 6)
                .animation(still ? nil : .easeOut(duration: 0.9).delay(0.2), value: up) }
            .accessibilityElement(children: .ignore).accessibilityLabel(String(format: "%.1f out of 100", card.total))
            VStack(alignment: .leading, spacing: 10) {
                Button { game.next() } label: { Text("Next \u{00B7} \(next)") }
                    .buttonStyle(MarqueeButton(height: 54)).accessibilityIdentifier("next").accessibilityLabel("Next jump: \(next)")
                HStack(spacing: 8) {
                    Button { game.retry() } label: { Text(String(format: "Beat %.1f", card.total)).frame(maxWidth: .infinity) }
                        .buttonStyle(MarqueeButton(height: 54, hollow: true)).accessibilityIdentifier("beat")
                        .accessibilityLabel(String(format: "Fly again: beat %.1f", card.total))
                    share
                }
                Button(action: more) { Label("The judges and the numbers", systemImage: "chevron.up").font(Theme.text(13, .medium)) }
                    .buttonStyle(QuietButton()).accessibilityIdentifier("first-more")
            }
            .padding(.top, 26)
            .opacity(up ? 1 : 0)
            .animation(still ? .easeOut(duration: 0.2) : .easeOut(duration: 0.4).delay(0.9), value: up)
        }
        .frame(maxWidth: 460, alignment: .leading)
        .padding(.horizontal, 24).padding(.bottom, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .background(alignment: .bottom) {
            // The words own the bottom of the screen: a deep scrim under them, the scene still the picture above.
            LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: Theme.bg.opacity(0.8), location: 0.28),
                                   .init(color: Theme.bg.opacity(0.94), location: 0.5), .init(color: Theme.bg.opacity(0.97), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 760).padding(.horizontal, -200).padding(.bottom, -60).allowsHitTesting(false).accessibilityHidden(true)
        }
        .task {
            up = true
            let total = card.total
            if still { shownScore = total; return }
            let steps = 36
            for i in 1...steps {
                try? await Task.sleep(for: .milliseconds(28))
                let k = Double(i) / Double(steps)
                withAnimation(.linear(duration: 0.03)) { shownScore = (total * (1 - pow(1 - k, 3)) * 10).rounded() / 10 }
            }
            shownScore = total
        }
    }
}
