// The encore's chrome (0271): the HUD and the controls are gone, the picture is the replay. One small tag in the corner, a
// hairline that runs out with it, and the whole screen a tap to skip to the card. Nothing else is said.
import SwiftUI

struct EncoreView: View {
    @ObservedObject var game = Game.shared
    let seconds: Double
    @State private var run = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.001)   // the tap target
                HStack(spacing: 8) {
                    Circle().fill(Theme.signal).frame(width: 6, height: 6)
                    Text("REPLAY").font(Theme.marquee(11, .footnote)).tracking(3).foregroundStyle(Theme.ink)
                }
                .padding(.leading, max(20, g.safeAreaInsets.leading + 16)).padding(.top, max(20, g.safeAreaInsets.top + 10))
                .shadow(color: .black.opacity(0.5), radius: 6)
                .accessibilityHidden(true)
                Rectangle().fill(Theme.ink.opacity(0.7))
                    .frame(width: run ? g.size.width : 0, height: 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(.bottom, max(14, g.safeAreaInsets.bottom + 4))
                    .accessibilityHidden(true)
            }
        }
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { game.skipEncore() }
        .accessibilityElement()
        .accessibilityLabel("Replay of the moment")
        .accessibilityHint("Double-tap to skip to the score")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { game.skipEncore() }
        .transition(.opacity)
        .onAppear { withAnimation(.linear(duration: seconds)) { run = true } }
    }
}

/// The card comes up out of the scene (0271): a short rise on a spring; with Reduce Motion, a plain fade.
struct Rise: ViewModifier {
    @State private var up = false
    @Environment(\.accessibilityReduceMotion) private var still
    func body(content: Content) -> some View {
        content
            .opacity(up ? 1 : 0)
            .offset(y: up || still ? 0 : 56)
            .onAppear { withAnimation(still ? .easeOut(duration: 0.2) : .spring(duration: 0.5, bounce: 0.14)) { up = true } }
    }
}
extension View { func rise() -> some View { modifier(Rise()) } }
