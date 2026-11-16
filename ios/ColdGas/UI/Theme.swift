// The web's look, carried over (src/styles.css: "keynote restraint"): one display face (Michroma), one text face
// (Geist), one mono (Geist Mono) for numbers; white on deep blue-black, one signal red, hairlines everywhere. The fonts
// are the web's own files (OFL, Resources/Fonts), registered at launch so Info.plist needn't list them.
import SwiftUI
import CoreText

enum Theme {
    static let ink = Color(red: 0.961, green: 0.965, blue: 0.973)
    static let ink2 = ink.opacity(0.72)
    static let ink3 = ink.opacity(0.46)
    static let hair = ink.opacity(0.16)
    static let hair2 = ink.opacity(0.08)
    static let bg = Color(red: 0.020, green: 0.027, blue: 0.047)
    static let glass = Color(red: 0.039, green: 0.051, blue: 0.078).opacity(0.58)
    static let signal = Color(red: 0.910, green: 0.196, blue: 0.235)
    static let ice = Color(red: 0.749, green: 0.902, blue: 1)
    static let ok = Color(red: 0.435, green: 0.941, blue: 0.710)
    static let amber = Color(red: 1, green: 0.749, blue: 0.353)
    static let hot = Color(red: 1, green: 0.353, blue: 0.384)

    static func display(_ size: CGFloat) -> Font { .custom("Michroma-Regular", size: size) }
    static func text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .custom("Geist", size: size).weight(weight) }
    static func mono(_ size: CGFloat, bold: Bool = false) -> Font { .custom(bold ? "GeistMono-Bold" : "GeistMono-Regular", size: size) }

    /// Register the bundled fonts once (before the first view draws).
    static func registerFonts() {
        let files = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
        for f in files { CTFontManagerRegisterFontsForURL(f as CFURL, .process, nil) }
    }
}

/// The show's marquee (0230): Michroma set big and wide for the one thing a screen is about (the event, the score's verdict),
/// a red tick for "on the mark" (the selected thing), and the two buttons every screen needs: one that is obviously the
/// next thing to do, and quiet words for everything else.
extension Theme {
    /// Michroma that follows Dynamic Type from `style` (callers cap the size range where a layout can't grow).
    static func marquee(_ size: CGFloat, _ style: Font.TextStyle = .title2) -> Font { .custom("Michroma-Regular", size: size, relativeTo: style) }
}

/// The signal-red mark beside what's chosen: the stage's mark, where the car comes down.
struct Tick: View {
    var on = true
    var length: CGFloat = 14
    var vertical = true
    var body: some View {
        Capsule().fill(Theme.signal)
            .frame(width: vertical ? 2 : length, height: vertical ? length : 2)
            .opacity(on ? 1 : 0)
            .accessibilityHidden(true)
    }
}

/// THE button of a screen: ink on the night, Michroma, tall. Fly, Fly again, Resume, Let's fly.
struct MarqueeButton: ButtonStyle {
    var height: CGFloat = 56
    /// The same block, hollow: a second choice that sits beside the first at its height (Roam beside Fly again).
    var hollow = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(hollow ? Theme.text(15, .medium) : Theme.marquee(15, .headline)).tracking(hollow ? 0.3 : 4)
            .textCase(hollow ? nil : .uppercase)
            .foregroundStyle(hollow ? Theme.ink : Theme.auroraInk)
            .lineLimit(1).minimumScaleFactor(0.7)
            .padding(.horizontal, hollow ? 16 : 22).frame(maxWidth: hollow ? nil : .infinity, minHeight: height)
            .background(hollow ? Theme.glass : Theme.ink, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(hollow ? Theme.hair : .clear, lineWidth: 1))
            .overlay(alignment: .bottom) {
                // The press lands on the mark: a red hairline under the button.
                Capsule().fill(Theme.signal).frame(height: 2).padding(.horizontal, 18).offset(y: 6)
                    .opacity(configuration.isPressed ? 1 : 0)
            }
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Everything that isn't the next thing to do: words (and an icon), no box, a 44 pt target.
struct QuietButton: ButtonStyle {
    var color: Color = Theme.ink2
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(14, .medium)).foregroundStyle(color)
            .lineLimit(1).minimumScaleFactor(0.75)
            .padding(.horizontal, 10).frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.5 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// A sheet's top edge: the close button, and (quietly, centred) what the sheet is. No large title, no subtitle.
struct SheetBar<Leading: View>: View {
    let name: String
    let close: () -> Void
    @ViewBuilder var leading: () -> Leading
    var body: some View {
        ZStack {
            Text(name.uppercased()).font(Theme.marquee(11, .footnote)).tracking(3).foregroundStyle(Theme.ink3)
                .lineLimit(1).accessibilityAddTraits(.isHeader).accessibilityLabel(name)
            HStack {
                leading()
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink2)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Done")
            }
        }
        .padding(.horizontal, 8).padding(.top, 6)
    }
}
extension SheetBar where Leading == EmptyView {
    init(name: String, close: @escaping () -> Void) { self.init(name: name, close: close) { EmptyView() } }
}

/// The web's glass panel: a hairline, a blur, a rounded rect.
struct Glass: ViewModifier {
    var radius: CGFloat = 14
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial.opacity(0.55), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background(Theme.glass, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.hair, lineWidth: 1))
    }
}
extension View { func glass(_ r: CGFloat = 14) -> some View { modifier(Glass(radius: r)) } }

/// The web's buttons: a primary (ink on dark, inverted) and a hairline secondary. Each tap is a selection tick.
struct CGButton: ButtonStyle {
    var primary = false
    var compact = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.text(15, .medium))
            .tracking(0.3)
            .foregroundStyle(primary ? Color(red: 0.027, green: 0.035, blue: 0.051) : Theme.ink)
            .lineLimit(1).minimumScaleFactor(0.8)
            .padding(.horizontal, compact ? 10 : 20).frame(minHeight: compact ? 44 : 48)
            .background(primary ? Theme.ink : Theme.glass, in: Capsule())
            .overlay(Capsule().strokeBorder(primary ? .clear : Theme.hair, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}
