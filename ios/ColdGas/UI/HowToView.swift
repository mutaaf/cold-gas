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

struct HowToView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    section("The car", "A roadster with ten cold-gas jets: four down-jets that lift and roll it, four rear jets that push it forward, and two nose jets that turn it. A tank of nitrogen feeds them all. When it's empty, you fall.")
                    section("One thumb (Assist, the Show and the Wall)", "Hold the pad to climb. A fan sucks the car onto the Wall, and the computer holds a crawl up the curl and stops you on the ledge, upside down.\nTap to let go. It drives out to the lip and pushes off.\nHold to land. Assist rolls you upright, carries you over the parked row on the Show, and brakes the fall with the down-jets. Slide your thumb while you hold to aim the touchdown: up is further, down is shorter.")
                    section("Classic (Pro, or any course)", "On the ground the stick steers, and GO and BRAKE are the pedals. LIFT on the ledge is the release.\nIn the air the stick rolls and pitches (push up for nose up). LIFT fires the down-jets, LAND levels you and brakes for you on Assist, and BOOST fires the rear jets.")
                    section("Advanced", "All ten valves by hand once you're off the Wall: a pad for each nozzle on a car outline, nose up, plus LIFT, BOOST and FRONTS. Slide a finger between pads. Scores ×1.15.")
                    section("A controller or a keyboard", "Pair either one and it takes over: left stick or arrows to steer and roll, right trigger or Space to LIFT, left trigger or Shift to LAND, RB or F to BOOST. Tap the screen to get the touch controls back.")
                    section("The judges", "Three judges score every run out of 100, each with their own priorities: the Engineer cares most about the landing (the sink rate, the tilt, four wheels down together), the Coordinator about the height and the rotation, and the Designer about the whole of it, gas left included. Pro scores ×1.08. Touch a parked car and the run is a crash.")
                    section("The board", "Post a scored run to today's board with three letters. The server flies your inputs again in the same physics to check the score, so the board is honest.")
                    section("iPhone Duo", "Opened flat, the game fills the whole screen. Fold it into tabletop, and the top half is the screen and the bottom half becomes the controller.")
                }
                .padding(20)
            }
            .navigationTitle("How to play")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
    private func section(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(Theme.display(11)).tracking(2).foregroundStyle(Theme.ink)
            Text(body).font(Theme.text(14)).foregroundStyle(Theme.ink2).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
    }
}
