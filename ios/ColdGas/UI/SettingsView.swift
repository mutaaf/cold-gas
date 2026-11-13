// Settings: haptics (Off / Subtle / Full), sound, the controls, units; the about lines, the privacy policy and the fonts'
// licences. Every choice is kept on this device (UserDefaults).
import SwiftUI
import ColdGasClient
import ColdGasLayout

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var game = Game.shared
    @State private var haptics = HapticPlayer.shared.level
    @State private var sound = Sound.shared.isEnabled
    @State private var music = Sound.shared.music
    @State private var effects = Sound.shared.effects
    @State private var units = SaveStore.shared.units.system
    @State private var tilt = SaveStore.shared.settings.tiltOn
    @State private var judgeOnDevice = SaveStore.shared.settings.judgeOnDeviceOn
    @State private var judgeStatus = OnDeviceJudges.status
    @State private var usage = SaveStore.shared.settings.usageOn
    private var judgeFooter: String {
        let scores = " Scores are the game\u{2019}s own; the model only writes the words."
        if judgeStatus != .available { return "\(judgeStatus.line) The free edge model writes them, over the network.\(scores)" }
        return judgeOnDevice
            ? "Apple Intelligence writes the judges\u{2019} words on this device: nothing is sent.\(scores)"
            : "The free edge model writes the judges\u{2019} words, over the network.\(scores)"
    }
    /// A sound level slider (0240): the car, the world and the hits ("Effects"), or the title's music.
    private func level(_ name: String, _ v: Binding<Double>, _ apply: @escaping (Double) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(name); Spacer(); Text(String(format: "%.0f%%", v.wrappedValue * 100)).font(Theme.mono(12)).foregroundStyle(Theme.ink2) }
            Slider(value: v, in: 0...1).accessibilityLabel(name).onChange(of: v.wrappedValue) { _, x in apply(x) }
        }
        .disabled(!sound)
        .opacity(sound ? 1 : 0.45)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Feel") {
                    Picker("Haptics", selection: $haptics) {
                        Text("Off").tag(HapticPlayer.Level.off)
                        Text("Subtle").tag(HapticPlayer.Level.subtle)
                        Text("Full").tag(HapticPlayer.Level.full)
                    }
                    .onChange(of: haptics) { _, v in HapticPlayer.shared.setLevel(v); UISelectionFeedbackGenerator().selectionChanged() }
                    Toggle("Sound", isOn: $sound).onChange(of: sound) { _, v in Sound.shared.setEnabled(v) }
                    level("Effects", $effects) { Sound.shared.effects = $0 }
                    level("Music", $music) { Sound.shared.music = $0 }
                }
                Section {
                    Picker("Controls", selection: $game.control) {
                        Text("One thumb").tag(Control.oneThumb)
                        Text("Classic").tag(Control.classic)
                    }
                    Toggle("Tilt to steer", isOn: $tilt)
                        .onChange(of: tilt) { _, v in var st = SaveStore.shared.settings; st.tilt = v; SaveStore.shared.settings = st }
                    Picker("Units", selection: $units) {
                        Text("US").tag(UnitSystem.us)
                        Text("Metric").tag(UnitSystem.metric)
                    }
                    .onChange(of: units) { _, v in var st = SaveStore.shared.settings; st.units = v; SaveStore.shared.settings = st }
                } header: { Text("Play") } footer: {
                    Text("One thumb flies Assist on the Show and the Wall. Classic flies everything.")
                }
                ControlsSection(close: { dismiss() })
                // 0219: who writes the judges' words on this device. The scores are always the game's own.
                Section {
                    Toggle("Judge on this device", isOn: $judgeOnDevice)
                        .disabled(judgeStatus != .available)
                        .onChange(of: judgeOnDevice) { _, v in var st = SaveStore.shared.settings; st.judgeOnDevice = v; SaveStore.shared.settings = st }
                    LabeledContent("The judges\u{2019} words", value: judgeStatus == .available && judgeOnDevice ? "Apple Intelligence" : "Edge model")
                } header: { Text("Judges") } footer: {
                    Text(judgeFooter)
                }
                // 0246: the usage counts the game sends, and the one switch that stops them.
                Section {
                    Toggle("Share usage stats", isOn: $usage)
                        .onChange(of: usage) { _, v in Usage.shared.setOn(v) }
                        .accessibilityIdentifier("usage")
                    Link("Privacy policy", destination: URL(string: "https://mutaafaziz.com/coldgas/privacy")!)
                } header: { Text("Privacy") } footer: {
                    Text("Counts like a jump started, landed or shared, with the course, tier and score, and a random id made on this iPhone. No name, initials, location or advertising id. Off sends nothing and deletes the id.")
                }
                Section("About") {
                    LabeledContent("Version", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    Link("Play on the web", destination: URL(string: "https://mutaafaziz.com/coldgas/")!)
                    NavigationLink("Licenses") { LicensesView() }
                }
            }
            .scrollContentBackground(.hidden)
            .font(Theme.text(15))
            .tint(Theme.ink)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct LicensesView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Michroma and Geist (Geist Mono) are used under the SIL Open Font License 1.1.").font(Theme.text(14)).foregroundStyle(Theme.ink2)
                Text("The physics engine is Rapier by Dimforge, used under the Apache License 2.0.").font(Theme.text(14)).foregroundStyle(Theme.ink2)
                ForEach(["OFL-Michroma", "OFL-Geist"], id: \.self) { f in
                    if let u = Bundle.main.url(forResource: f, withExtension: "txt") ?? Bundle.main.url(forResource: f, withExtension: "txt", subdirectory: "Fonts"),
                       let s = try? String(contentsOf: u, encoding: .utf8) {
                        Text(s).font(Theme.mono(11)).foregroundStyle(Theme.ink3)
                    }
                }
            }.padding(20)
        }
        .navigationTitle("Licenses")
    }
}

/// Settings → Controls (0221): the HUD layout editor, the stick, the buttons, Free Drive's look. Each change is saved as it's
/// made and reaches the controls at once.
struct ControlsSection: View {
    let close: () -> Void
    @ObservedObject var hud = HudStore.shared
    private func bind<T>(_ get: @escaping (HudPrefs) -> T, _ set: @escaping (inout HudPrefs, T) -> Void) -> Binding<T> {
        Binding(get: { get(hud.prefs) }, set: { v in hud.update { set(&$0, v) } })
    }
    var body: some View {
        Section {
            Button {
                // The sheet goes first, then the editor opens over the title on the tier that's chosen there.
                close()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { HudStore.shared.editing = DeckGeometry.tier }
            } label: {
                LabeledContent { Image(systemName: "chevron.right").foregroundStyle(Theme.ink3) } label: {
                    Label("Edit the layout", systemImage: "rectangle.and.hand.point.up.left")
                }
            }
            .accessibilityIdentifier("edit-layout")
            .accessibilityHint("Move, size and fade every touch control, for each tier and each way you hold the screen")
            Picker("Stick", selection: bind({ $0.stick }, { $0.stickMode = $1 })) {
                ForEach(StickMode.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            slider("Dead zone", bind({ $0.dead }, { $0.deadZone = $1 }), HudPrefs.deadZones, "%.0f%%", 100)
            slider("Stick sensitivity", bind({ $0.sens }, { $0.sensitivity = $1 }), HudPrefs.sensitivities, "%.2f×", 1)
            Toggle("Tap BRAKE to hold it", isOn: bind({ $0.brakeToggles }, { $0.brakeToggle = $1 }))
            Toggle("Tap BOOST to hold it", isOn: bind({ $0.boostToggles }, { $0.boostToggle = $1 }))
            Toggle("RELEASE when the finger lifts", isOn: bind({ $0.releasesOnLift }, { $0.releaseOnLift = $1 }))
            slider("Free Drive look", bind({ $0.lookSens }, { $0.lookSensitivity = $1 }), HudPrefs.lookSensitivities, "%.2f×", 1)
            Toggle("Invert the look", isOn: bind({ $0.lookInvert }, { $0.lookInvertY = $1 }))
        } header: { Text("Controls") } footer: {
            Text("A layout is kept for each tier and each way you hold the screen. In Free Drive, swipe off the controls to look round.")
        }
    }
    private func slider(_ name: String, _ v: Binding<Double>, _ r: ClosedRange<Double>, _ fmt: String, _ k: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack { Text(name); Spacer(); Text(String(format: fmt, v.wrappedValue * k)).font(Theme.mono(12)).foregroundStyle(Theme.ink2) }
            Slider(value: v, in: r).accessibilityLabel(name)
        }
    }
}
