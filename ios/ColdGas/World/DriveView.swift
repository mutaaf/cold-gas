// Free Drive's screen over the scene: Back, the speed, how far out, the heading; a veil until the world near the car is
// built. Hairline glass, as the run's HUD.
import SwiftUI
import ColdGasClient

struct DriveView: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    private let stats = Launch.args.contains("-fd-stats")
    var body: some View {
        let h = game.driveHud
        let safe = CGRect(x: layout.scene.minX + layout.safe.leading, y: layout.scene.minY + layout.safe.top,
                          width: layout.scene.width - layout.safe.leading - layout.safe.trailing, height: layout.scene.height - layout.safe.top - layout.safe.bottom)
        ZStack(alignment: .topLeading) {
            if !h.ready {
                ZStack {
                    Theme.bg.opacity(0.92)
                    VStack(spacing: 10) {
                        Text("FREE DRIVE").font(Theme.display(13)).tracking(6).foregroundStyle(Theme.ink2)
                        Text("Raising the land").font(Theme.text(13)).foregroundStyle(Theme.ink3)
                    }
                }
                .frame(width: layout.scene.width, height: layout.scene.height).offset(x: layout.scene.minX, y: layout.scene.minY)
                .transition(.opacity)
            }
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    Button { game.endDrive(); UISelectionFeedbackGenerator().selectionChanged() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink2).frame(width: 44, height: 44).glass(22)
                    }.buttonStyle(.plain).accessibilityLabel("Back to the title")
                    Spacer()
                    HStack(spacing: 16) {
                        readout("SPEED", Fmt.speed(h.speed), Fmt.speedUnit)
                        readout("OUT", String(format: "%.1f", h.km), "km")
                        readout("HDG", String(format: "%03.0f", h.heading), "°")
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8).glass(12)
                }
                Spacer()
                if stats { Text(h.line).font(Theme.mono(11)).foregroundStyle(Theme.ink2).padding(8).glass(10) }
            }
            .padding(12)
            .frame(width: safe.width, height: safe.height).offset(x: safe.minX, y: safe.minY)
        }
        .animation(.easeOut(duration: 0.4), value: h.ready)
    }
    private func readout(_ label: String, _ v: String, _ unit: String) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(label).font(Theme.text(11, .medium)).tracking(1.4).foregroundStyle(Theme.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(v).font(Theme.mono(19)).foregroundStyle(Theme.ink).monospacedDigit()
                Text(unit).font(Theme.text(11)).foregroundStyle(Theme.ink3)
            }
        }
    }
}
