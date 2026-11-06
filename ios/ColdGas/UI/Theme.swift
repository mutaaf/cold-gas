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
