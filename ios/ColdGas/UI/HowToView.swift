// How to play: the web's how-to, for touch (index.html's how-to and src/onethumb.js's words).
import SwiftUI
import ColdGasClient
import ColdGasPhysics

/// The drills for the course on the title (src/practice.js): one part of the flight, handed over mid-run. Not on the board.
struct PracticeView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var game = Game.shared
    let start: (String) -> Void
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(drillsFor(game.course), id: \.id) { d in
                        Button { start(d.id) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(d.label.uppercased()).font(Theme.display(12)).tracking(2).foregroundStyle(Theme.ink)
                                Text(SaveStore.shared.units.localize(d.blurb)).font(Theme.text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                                Text(d.goal).font(Theme.text(12, .medium)).foregroundStyle(Theme.ice)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.hair)).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    if drillsFor(game.course).isEmpty { Text("No drills on this course.").font(Theme.text(14)).foregroundStyle(Theme.ink3) }
                    Text("Practice runs don't go on the board.").font(Theme.text(11)).foregroundStyle(Theme.ink3).padding(.top, 6)
                }.padding(16)
            }
            .navigationTitle("Practice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// The whole game at a glance, then the rest folded: a person can start flying from the first screenful.
struct HowToView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var open: String?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    theGame
                    theScore
                    VStack(spacing: 0) {
                        fold("One thumb", "Assist, on the Show and the Wall") {
                            KeyLine("HOLD", "A fan sucks the car onto the Wall. The computer crawls up the curl and stops on the ledge, upside down.")
                            KeyLine("TAP", "It drives out to the lip and pushes off.")
                            KeyLine("HOLD", "Assist rolls you upright, carries you over the parked row on the Show, and brakes the fall.")
                            KeyLine("SLIDE", "While you hold, aim the touchdown: up is further, down is shorter.")
                        }
                        fold("Classic", "Stick and pedals: Pro, or any course") {
                            label("On the ground")
                            KeyLine("STICK", "Steers.")
                            KeyLine("GO, BRAKE", "The pedals.")
                            KeyLine("LIFT", "On the ledge, the release.")
                            label("In the air")
                            KeyLine("STICK", "Rolls and pitches. Push up for nose up.")
                            KeyLine("LIFT", "Fires the down-jets.")
                            KeyLine("LAND", "Levels you, and brakes for you on Assist.")
                            KeyLine("BOOST", "Fires the rear jets.")
                        }
                        fold("Advanced", "All ten valves by hand, scores ×1.15") {
                            KeyLine("PADS", "One for each nozzle on a car outline, nose up, once you're off the Wall. Slide a finger between them.")
                            KeyLine("ALSO", "LIFT, BOOST and FRONTS.")
                        }
                        fold("The car", "Ten cold-gas jets, one tank") {
                            KeyLine("4 DOWN", "Lift it and roll it.")
                            KeyLine("4 REAR", "Push it forward.")
                            KeyLine("2 NOSE", "Turn it.")
                            KeyLine("TANK", "Nitrogen feeds them all. When it's empty, you fall.")
                        }
                        fold("The judges", "Three scores, each out of 100") {
                            KeyLine("ENGINEER", "The landing: sink rate, tilt, four wheels down together.")
                            KeyLine("COORD.", "The height and the rotation.")
                            KeyLine("DESIGNER", "The whole of it, gas left included.")
                        }
                        fold("The board", "Today's scores, checked by the server") {
                            KeyLine("POST", "A scored run, with three letters.")
                            KeyLine("CHECK", "The server scores your run itself and checks it's plausible, so a score can't just be sent in.")
                        }
                        fold("Controller or keyboard", "Pair one and it takes over") {
                            KeyLine("STEER", "Left stick or arrows, to steer and roll.")
                            KeyLine("LIFT", "Right trigger or Space.")
                            KeyLine("LAND", "Left trigger or Shift.")
                            KeyLine("BOOST", "RB or F.")
                            KeyLine("TOUCH", "Tap the screen to get the touch controls back.")
                        }
                        fold("iPhone Duo", "Flat, or folded into tabletop") {
                            KeyLine("FLAT", "The game fills the whole screen.")
                            KeyLine("TABLETOP", "The top half is the screen, the bottom half the controller.")
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("How to play")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private var theGame: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("One thumb, the whole flight")
            HStack(spacing: 8) {
                step("HOLD", "to climb", phase: 0)
                step("TAP", "to let go", phase: 190)
                step("HOLD", "to land", phase: 375)
            }
            Text("Slide your thumb while you hold to aim the touchdown.").font(Theme.text(13)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func step(_ verb: String, _ what: String, phase: CGFloat) -> some View {
        VStack(spacing: 3) {
            Text(verb).font(Theme.display(16)).foregroundStyle(Theme.auroraInk).lineLimit(1).minimumScaleFactor(0.7)
            Text(what).font(Theme.text(13, .medium)).foregroundStyle(Theme.auroraInk2).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 16)
        .aurora(12, phase: phase)
        .accessibilityElement(children: .combine)
    }

    private var theScore: some View {
        VStack(alignment: .leading, spacing: 8) {
            label("What scores")
            HStack(spacing: 8) {
                fact("Soft", "low sink")
                fact("Level", "low tilt")
                fact("Square", "four wheels")
            }
            HStack(spacing: 8) {
                tag("Pro ×1.08", color: Theme.ink)
                tag("Advanced ×1.15", color: Theme.ink)
                tag("Parked car: crash", color: Theme.hot)
            }
        }
    }
    private func fact(_ big: String, _ small: String) -> some View {
        VStack(spacing: 3) {
            Text(big).font(Theme.text(16, .semibold)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.8)
            Text(small).font(Theme.text(12)).foregroundStyle(Theme.ink2).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hair))
        .accessibilityElement(children: .combine)
    }
    private func tag(_ s: String, color: Color) -> some View {
        Text(s).font(Theme.text(12, .medium)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity).padding(.vertical, 8)
            .overlay(Capsule().strokeBorder(Theme.hair))
    }
    private func label(_ s: String) -> some View {
        Text(s.uppercased()).font(Theme.text(10, .medium)).tracking(1.4).foregroundStyle(Theme.ink3).padding(.top, 2)
    }
    /// One open at a time, so the page stays short.
    private func fold<C: View>(_ title: String, _ summary: String, @ViewBuilder _ body: @escaping () -> C) -> some View {
        VStack(spacing: 0) {
            Accordion(title: title, summary: summary, isOpen: Binding(get: { open == title }, set: { open = $0 ? title : nil })) {
                VStack(alignment: .leading, spacing: 8) { body() }
            }
            Rectangle().fill(Theme.hair2).frame(height: 1)
        }
    }
}
