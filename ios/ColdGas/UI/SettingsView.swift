// Settings: haptics (Off / Subtle / Full), sound, the controls, units; the about lines, the privacy policy and the fonts'
// licences. Every choice is kept on this device (UserDefaults).
import SwiftUI
import ColdGasClient

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var game = Game.shared
    @State private var haptics = HapticPlayer.shared.level
    @State private var sound = Sound.shared.isEnabled
    @State private var units = SaveStore.shared.units.system
    @State private var tilt = SaveStore.shared.settings.tiltOn
    @State private var judgeOnDevice = SaveStore.shared.settings.judgeOnDeviceOn
    @State private var judgeStatus = OnDeviceJudges.status
    private var judgeFooter: String {
        let scores = " The scores are always the game\u{2019}s own; the model writes the words."
        if judgeStatus != .available { return "\(judgeStatus.line) The free edge model writes the judges\u{2019} words over the network.\(scores)" }
        return judgeOnDevice
            ? "The judges use Apple Intelligence: their words are written on this device, with no network call and no cost: the judging sends nothing off this device.\(scores)"
            : "The judges\u{2019} words come from the free edge model, over the network.\(scores)"
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
                    Text("One thumb flies Assist on the Show and the Wall: hold to climb, tap to let go, hold to land. Classic is the stick and the pedals, on every course and tier.")
                }
                // 0219: who writes the judges' words on this device. The scores are always the game's own.
                Section {
                    Toggle("Judge on this device", isOn: $judgeOnDevice)
                        .disabled(judgeStatus != .available)
                        .onChange(of: judgeOnDevice) { _, v in var st = SaveStore.shared.settings; st.judgeOnDevice = v; SaveStore.shared.settings = st }
                    LabeledContent("The judges\u{2019} words", value: judgeStatus == .available && judgeOnDevice ? "Apple Intelligence" : "Edge model")
                } header: { Text("Judges") } footer: {
                    Text(judgeFooter)
                }
                Section("About") {
                    LabeledContent("Version", value: "\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    Link("Play on the web", destination: URL(string: "https://mutaafaziz.com/coldgas/")!)
                    Link("Privacy policy", destination: URL(string: "https://mutaafaziz.com/coldgas/privacy")!)
                    NavigationLink("Licenses") { LicensesView() }
                }
            }
            .scrollContentBackground(.hidden)
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
