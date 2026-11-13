// The web's aurora (src/styles.css --aur-1…3, .runline's new best): near-black ink on a slowly moving bright field, for the
// few things a screen has to say at a glance. A crash or a wreck never gets it (audit 2026-10-30). Everything else folds away.
import SwiftUI

extension Theme {
    static let aur1 = Color(red: 0.361, green: 1, blue: 0.784)      // #5cffc8
    static let aur2 = Color(red: 0.310, green: 0.702, blue: 1)      // #4fb3ff
    static let aur3 = Color(red: 0.690, green: 0.482, blue: 1)      // #b07bff
    static let auroraInk = Color(red: 0.027, green: 0.035, blue: 0.051)
    static let auroraInk2 = auroraInk.opacity(0.8)
}

/// The moving field behind a view. One colour cycle is 750 pt, so a small tile shows about one colour and `phase` picks which
/// (0 mint, 190 blue, 375 violet). Violet goes back through blue: straight to mint it greys. The strip slides and the render server moves it; Reduce Motion holds it still.
struct AuroraBackground: ViewModifier {
    var radius: CGFloat = 12
    var phase: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var moving = false
    private static let cycle: CGFloat = 750
    private static let strip = LinearGradient(colors: [Theme.aur1, Theme.aur2, Theme.aur3, Theme.aur2, Theme.aur1, Theme.aur2, Theme.aur3, Theme.aur2, Theme.aur1, Theme.aur2, Theme.aur3, Theme.aur2, Theme.aur1], startPoint: .leading, endPoint: .trailing)
    func body(content: Content) -> some View {
        content
            .background(alignment: .leading) {
                Self.strip.frame(width: Self.cycle * 3)
                    .offset(x: moving ? -(phase + Self.cycle) : -phase)
                    .animation(moving ? .linear(duration: 12).repeatForever(autoreverses: false) : nil, value: moving)
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .onAppear { if !still { moving = true } }
            .onChange(of: still) { _, s in moving = !s }
    }
}
extension View { func aurora(_ radius: CGFloat = 12, phase: CGFloat = 0) -> some View { modifier(AuroraBackground(radius: radius, phase: phase)) } }

/// One accordion row: the title and a line that says what's inside, the rest on a tap. A selection tick, as every tap has.
struct Accordion<Content: View>: View {
    let title: String
    let summary: String
    @Binding var isOpen: Bool
    /// What the closed row shows (0230): the title (a fold in a list), or only the summary (the numbers themselves); the
    /// other is still read by VoiceOver.
    var show: Show = .title
    @ViewBuilder var content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var still
    enum Show { case title, summary, both }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                withAnimation(still ? nil : .snappy(duration: 0.24)) { isOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        if show != .summary {
                            Text(title.uppercased()).font(Theme.display(11)).tracking(1.6).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
                        }
                        if show != .title {
                            Text(summary).font(show == .summary ? Theme.mono(13) : Theme.text(13)).foregroundStyle(Theme.ink2).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(isOpen ? Theme.aur1 : Theme.ink3)
                        .rotationEffect(.degrees(isOpen ? 180 : 0)).accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.vertical, 8).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityValue(isOpen ? "Open" : "Closed")
            .accessibilityHint(summary)
            if isOpen {
                content().padding(.bottom, 14).transition(.opacity)
            }
        }
    }
}

/// A term and what it does, in a line: the shape of everything in an accordion.
struct KeyLine: View {
    let key: String
    let value: String
    init(_ key: String, _ value: String) { self.key = key; self.value = value }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(key).font(Theme.mono(11, bold: true)).foregroundStyle(Theme.aur1).frame(width: 66, alignment: .leading).lineLimit(1).minimumScaleFactor(0.7)
            Text(value).font(Theme.text(14)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
