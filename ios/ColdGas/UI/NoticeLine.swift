// One calm line at the top of the screen (0293): something failed that the player should know about, said in the game's
// own voice. A hairline on the night, the signal red only as the tick; a tap dismisses it (or retries, when it says so).
import SwiftUI

struct NoticeLine: View {
    let notice: Notice
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Tick(on: true, length: 12, vertical: true)
                Text(notice.text).font(Theme.text(13)).foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Theme.bg.opacity(0.88), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hair, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
        .padding(.horizontal, 16)
        .accessibilityLabel(notice.text)
        .accessibilityHint(notice.action == .retryStage ? "Tries again" : "Dismisses")
    }
}
