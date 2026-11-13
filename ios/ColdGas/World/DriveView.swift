// Free Drive's screen over the scene: Back, the speed, how far out, the heading; the camera, reset and fan switches; the
// classic controls (the stick, GO and BRAKE on the ground, LIFT and LAND in the air: the run's own pad, Input/); a veil
// until the world near the car is built. Hairline glass, as the run's HUD.
import SwiftUI
import ColdGasClient

struct DriveView: View {
    @ObservedObject var game = Game.shared
    @ObservedObject var layout: LayoutModel
    /// The world's numbers on screen (`-fd-stats`): a Debug tool, never in a Release build.
    #if DEBUG
    private let stats = Launch.args.contains("-fd-stats")
    #else
    private let stats = false
    #endif
    var body: some View {
        let h = game.driveHud
        let rows = layout.spread == .rows
        let safe = CGRect(x: layout.scene.minX + layout.safe.leading, y: layout.scene.minY + layout.safe.top,
                          width: layout.scene.width - layout.safe.leading - (rows ? 0 : layout.safe.trailing),
                          height: layout.scene.height - layout.safe.top - (rows ? 0 : layout.safe.bottom))
        ZStack(alignment: .topLeading) {
            if h.ready {
                ClassicSurface(panel: rows, air: h.air)
                    .frame(width: layout.controls.width, height: layout.controls.height).offset(x: layout.controls.minX, y: layout.controls.minY)
            }
            VStack(spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Button { game.endDrive(); UISelectionFeedbackGenerator().selectionChanged() } label: {
                            Image(systemName: "chevron.left").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink2).frame(width: 44, height: 44).glass(22)
                        }.buttonStyle(.plain).accessibilityLabel("Back to the title")
                        // On a roam: straight into a scored run on this course (0220). Under Back, so the readouts keep their row.
                        if let c = game.roamedFrom, h.ready {
                            Button { game.flyFromRoam(); UISelectionFeedbackGenerator().selectionChanged() } label: {
                                Text("Fly \(COURSE_INFO.first { $0.id == c }?.name ?? "it")").font(Theme.text(13, .medium)).foregroundStyle(Theme.ink)
                                    .lineLimit(1).fixedSize().padding(.horizontal, 16).frame(height: 44).glass(22)
                            }.buttonStyle(.plain).accessibilityIdentifier("roam-fly").accessibilityHint("A scored run from the mark.")
                        }
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 8) {
                        HStack(spacing: 16) {
                            readout("SPEED", Fmt.speed(h.speed), Fmt.speedUnit)
                            readout("OUT", String(format: "%.1f", h.km), "km")
                            readout("HDG", String(format: "%03.0f", h.heading), "°")
                        }
                        .padding(.horizontal, 14).padding(.vertical, 8).glass(12)
                        HStack(spacing: 8) {
                            toggle(h.cam == "chase" ? "video" : "car.side", h.cam == "chase" ? "Chase camera" : "Bumper camera", on: false) { game.freeDrive?.camera.cycle() }
                            toggle("fanblades", h.fan ? "Fan armed" : "Fan off", on: h.fan) { game.freeDrive?.fan.toggle() }
                            toggle("arrow.uturn.backward", "Back on the road", on: false) { game.freeDrive?.reset() }
                        }
                    }
                }
                if !h.cue.isEmpty {
                    // Centred, except on the open Duo: there it starts just right of the crease.
                    let crease = layout.crease(in: safe)
                    HStack(spacing: 0) {
                        if let c = crease { Spacer().frame(width: max(0, c.upperBound + 10 - 12)) } else { Spacer() }
                        Text(h.cue).font(Theme.text(14, .medium)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 14).padding(.vertical, 8).glass(18)
                        Spacer()
                    }
                    .padding(.top, 10)
                    .transition(.opacity).id(h.cue)
                }
                Spacer()
                if stats { Text(h.line).font(Theme.mono(11)).foregroundStyle(Theme.ink2).padding(8).glass(10).padding(.bottom, 200) }
            }
            .padding(12)
            .frame(width: safe.width, height: safe.height).offset(x: safe.minX, y: safe.minY)
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
        }
        .animation(.easeOut(duration: 0.4), value: h.ready)
        .animation(.easeOut(duration: 0.25), value: h.cue)
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
    private func toggle(_ icon: String, _ label: String, on: Bool, _ act: @escaping () -> Void) -> some View {
        Button { act(); UISelectionFeedbackGenerator().selectionChanged() } label: {
            Image(systemName: icon).font(.system(size: 14, weight: .regular)).foregroundStyle(on ? Theme.ink : Theme.ink2)
                .frame(width: 44, height: 44).glass(22)
                .overlay(Circle().strokeBorder(on ? Theme.ink.opacity(0.6) : .clear, lineWidth: 1))
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}
