// What's new (owner, 2026-11-10): once after an update, on the title, a bright card of what changed. The words are
// release-notes/<version>.md, bundled (the same file TestFlight and the store read; release-notes/README.md). When it shows
// is ColdGasClient's WhatsNewGate: never on a fresh install, once per version, never under a test or a tool's flag.
// DEBUG: `-whatsNew` forces it (shots, a look on a phone), and records nothing (WhatsNewGate.decide's `forced`).
// A card whose Highlight names `go:` is a button: it closes the modal and opens that screen (RootUI routes it).
import SwiftUI
import ColdGasClient

enum WhatsNewStore {
    static var currentVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }

    static func notes(for version: String) -> ReleaseNotes? {
        guard let u = Bundle.main.url(forResource: version, withExtension: "md", subdirectory: "release-notes")
                ?? Bundle.main.url(forResource: version, withExtension: "md"),
              let s = try? String(contentsOf: u, encoding: .utf8) else { return nil }
        return ReleaseNotes.parse(s)
    }

    /// The notes to show at launch, or nil. Records the version as seen as the gate says.
    static func atLaunch(defaults: UserDefaults = .standard) -> ReleaseNotes? {
        let v = currentVersion
        #if DEBUG
        let forced = Launch.args.contains(WhatsNewGate.forceFlag)
        #else
        let forced = false
        #endif
        let quiet = WhatsNewGate.isQuiet(arguments: Launch.args, environment: ProcessInfo.processInfo.environment)
        let notes = notes(for: v)
        let d = WhatsNewGate.decide(current: v, seen: defaults.string(forKey: WhatsNewGate.seenKey), quiet: quiet,
                                    hasNotes: notes != nil, forced: forced)
        if let r = d.record { defaults.set(r, forKey: WhatsNewGate.seenKey) }
        return d.show ? notes : nil
    }
}

struct WhatsNewView: View {
    let notes: ReleaseNotes
    let dismiss: () -> Void
    /// A card with a destination: close the modal and open that screen.
    let go: (WhatsNewDestination) -> Void
    @State private var fullOpen = false
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var still

    // Michroma and Geist scale with Dynamic Type here (relativeTo), capped so the cards stay cards.
    private func display(_ s: CGFloat) -> Font { .custom("Michroma-Regular", size: s, relativeTo: .title2) }
    private func text(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .custom("Geist", size: s, relativeTo: .body).weight(w) }

    var body: some View {
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea().accessibilityHidden(true)
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        hero
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                            ForEach(Array(notes.callouts.enumerated()), id: \.offset) { i, c in card(c, i) }
                        }
                        if !notes.sections.isEmpty {
                            Accordion(title: "The full notes", summary: notes.sections.map(\.title).joined(separator: " · "), isOpen: $fullOpen) {
                                VStack(alignment: .leading, spacing: 14) {
                                    ForEach(Array(notes.sections.enumerated()), id: \.offset) { _, s in
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text(s.title.uppercased()).font(Theme.display(10)).tracking(1.6).foregroundStyle(Theme.aur1)
                                                .accessibilityAddTraits(.isHeader)
                                            ForEach(Array(s.lines.enumerated()), id: \.offset) { _, l in
                                                Text(l).font(text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.horizontal, 14)
                            .background(Theme.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hair, lineWidth: 1))
                        }
                    }
                    .padding(16)
                }
                .scrollBounceBehavior(.basedOnSize)
                Button(action: dismiss) { Text("Let's fly").frame(maxWidth: .infinity) }
                    .buttonStyle(CGButton(primary: true))
                    .accessibilityIdentifier("whatsnew-dismiss")
                    .accessibilityHint("Closes what's new")
                    .padding(.horizontal, 16).padding(.bottom, 16).padding(.top, 4)
            }
            // Opaque enough that the title under it never reads through the cards.
            .background(Theme.bg.opacity(0.94), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.hair, lineWidth: 1))
            .frame(maxWidth: 480)
            .padding(.horizontal, 14).padding(.vertical, 18)
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            .opacity(shown ? 1 : 0)
            .offset(y: shown || still ? 0 : 18)
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
            .accessibilityIdentifier("whatsnew")
        }
        .onAppear { withAnimation(still ? .easeOut(duration: 0.15) : .spring(duration: 0.5, bounce: 0.18)) { shown = true } }
        .accessibilityAction(.escape, dismiss)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WHAT'S NEW · \(notes.title.replacingOccurrences(of: "Cold Gas ", with: "V").uppercased())")
                .font(Theme.mono(11, bold: true)).tracking(1.4).foregroundStyle(Theme.auroraInk2)
            Text(notes.headline).font(display(21)).foregroundStyle(Theme.auroraInk)
                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
            if !notes.lede.isEmpty {
                Text(notes.lede).font(text(14, .medium)).foregroundStyle(Theme.auroraInk2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .aurora(18)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("What's new. \(notes.headline). \(notes.lede)")
    }

    /// What a card's button says, by where it goes.
    static func label(_ d: WhatsNewDestination) -> String {
        switch d {
        case .board: "See the board"
        case .settings: "Open Settings"
        case .howTo: "Read How to play"
        case .practice: "Try a drill"
        }
    }

    @ViewBuilder private func card(_ c: ReleaseNotes.Callout, _ i: Int) -> some View {
        if let d = c.go {
            Button { go(d) } label: { cardBody(c, i, go: d) }
                .buttonStyle(CardPress())
                .accessibilityIdentifier("whatsnew-go-\(d.rawValue)")
                .accessibilityLabel("\(c.title). \(c.line)")
                .accessibilityHint(Self.label(d))
        } else {
            cardBody(c, i, go: nil)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(c.title). \(c.line)")
        }
    }

    private func cardBody(_ c: ReleaseNotes.Callout, _ i: Int, go d: WhatsNewDestination?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: c.icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.auroraInk)
                .frame(width: 36, height: 36).aurora(10, phase: CGFloat(i) * 190).accessibilityHidden(true)
            Text(c.title.uppercased()).font(Theme.display(11)).tracking(1.2).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(c.line).font(text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let d {
                HStack(spacing: 5) {
                    Text(Self.label(d))
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                }
                .font(text(12, .semibold)).foregroundStyle(Theme.auroraInk)
                .padding(.horizontal, 11).frame(minHeight: 30)
                .aurora(15, phase: CGFloat(i) * 190)
                .accessibilityHidden(true)
            }
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(Theme.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hair, lineWidth: 1))
        .opacity(shown ? 1 : 0)
        .animation(still ? nil : .easeOut(duration: 0.4).delay(0.12 + Double(i) * 0.07), value: shown)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A callout card that's a button: the whole card is the target, and it gives a little when pressed.
private struct CardPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
