// Roam's challenges on screen (0272): a short list under Fly, a tick when one's done and the best beside it, and a way to
// stand the set up again. Unscored and unhurried: no timer, no streak, no reward to chase; Fly is one tap above it.
import SwiftUI
import ColdGasPhysics

enum RoamText {
    static func task(_ k: SetChallengeKind) -> String {
        switch k {
        case .lip: return "Leave the curl at its lip"
        case .row: return "Fly the row end to end"
        case .mark: return "Land on the mark"
        case .tyres: return "Topple six tyres"
        case .lane: return "Run the cone lane clean, \(Fmt.speed(SetChallenges.laneExit)) \(Fmt.speedUnit) out"
        }
    }
    static func value(_ k: SetChallengeKind, _ v: Double) -> String {
        switch k {
        case .lip, .lane: return "\(Fmt.speed(v)) \(Fmt.speedUnit)"
        case .row: return "\(Fmt.length(v)) \(Fmt.lengthUnit) over"
        case .mark: return "\(Fmt.length(v)) \(Fmt.lengthUnit) off"
        case .tyres: return "\(Int(v)) down"
        }
    }
    static func cue(_ e: SetChallengeEvent) -> String {
        let v = value(e.kind, e.value)
        let what: String
        switch e.kind {
        case .lip: what = "Off the lip"
        case .row: what = "Over the row"
        case .mark: what = "On the mark"
        case .tyres: what = "Tyres down"
        case .lane: what = "Clean lane"
        }
        return e.first ? "\(what) · \(v)" : "\(what) · new best, \(v)"
    }
}

struct RoamChallengesView: View {
    let rows: [RoamChallengeRow]
    let reset: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ON THIS SET").font(Theme.text(11, .medium)).tracking(1.4).foregroundStyle(Theme.ink3)
            ForEach(rows, id: \.id) { r in
                HStack(spacing: 8) {
                    Image(systemName: r.done ? "checkmark.circle.fill" : "circle").font(.system(size: 12)).foregroundStyle(r.done ? Theme.ink : Theme.ink3)
                    Text(r.text).font(Theme.text(12)).foregroundStyle(r.done ? Theme.ink2 : Theme.ink).lineLimit(1)
                    if !r.best.isEmpty { Text(r.best).font(Theme.mono(11)).foregroundStyle(Theme.ink3).monospacedDigit().lineLimit(1) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(r.text), \(r.done ? "done, best \(r.best)" : "not yet")")
            }
            Button(action: reset) {
                Label("Stand the set up again", systemImage: "arrow.counterclockwise").font(Theme.text(12, .medium)).foregroundStyle(Theme.ink2)
                    .frame(minHeight: 32)
            }.buttonStyle(.plain).accessibilityIdentifier("roam-reset-set")
        }
        .fixedSize()
        .padding(.horizontal, 12).padding(.vertical, 8).glass(12)
        .accessibilityIdentifier("roam-challenges")
    }
}
