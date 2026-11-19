// The settings kept outside the save, repaired before anything reads them (0301; docs/AUDIT-2026-11-18.md "Hardened").
// The save itself (SaveData) already tolerates a damaged field (0154) and a damaged blob (0293). These are the plain
// UserDefaults keys beside it: the look, the course, the tier, the control scheme. A value this build doesn't know (an older
// or newer build's, a hand-edited plist, the wrong type) used to flow straight in: an unknown course asked for a stage that
// doesn't exist (a black title), an unknown tier sent a usage event its props were dropped from. Now each is put back to its
// default at launch, before Game or the renderer reads it, and reported once (Report: `setting <key> …`).
import Foundation
import ColdGasClient
import ColdGasPhysics

enum Prefs {
    static let TIERS = ["assist", "pro", "advanced"]

    /// Repairs every key, at launch (AppDelegate, before Game.shared or Look.current is touched). Returns the keys repaired.
    @discardableResult
    static func repair(_ d: UserDefaults = .standard) -> [String] {
        var fixed: [String] = []
        func fix(_ key: String, _ allowed: [String], _ fallback: String) {
            let raw = d.object(forKey: key)
            if raw != nil && !(raw is String) {   // the wrong type entirely: gone, so the default applies
                d.removeObject(forKey: key); fixed.append(key)
                Report.error(.app, .error, "setting \(key) unreadable: reset")
                return
            }
            let g = Guard.oneOf(raw as? String, allowed, fallback: fallback)
            if g.repaired {
                d.set(g.value, forKey: key); fixed.append(key)
                Report.error(.app, .error, "setting \(key) unknown: reset")
            }
        }
        fix(Look.key, Look.allCases.map(\.rawValue), Look.real.rawValue)
        fix("cg.course", COURSE_IDS, "show")
        fix("cg.tier", TIERS, "assist")
        fix("cg.control", Control.allCases.map(\.rawValue), Control.oneThumb.rawValue)
        return fixed
    }
}

#if DEBUG
import SwiftUI
import UIKit

/// `-uitest`: a one-point label the UI tests read (identifier `health`): "faults N" and the first few, refreshed each second.
struct HealthProbe: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let f = ReportCenter.shared.faultsSeen
            Text("faults \(f.count)")
                .font(.system(size: 1)).opacity(0.02).frame(width: 1, height: 1).allowsHitTesting(false)
                .accessibilityIdentifier("health")
                .accessibilityValue(f.prefix(4).joined(separator: " | "))
        }
    }
}

/// DEBUG fault injection for the hardening tests (0301). Each flag stands in for something the simulator can't do on cue:
///   -corrupt-prefs        the plain settings hold values this build doesn't know (before Prefs.repair runs)
///   -memwarn <s>          a memory warning <s> seconds after launch (as Simulator's Debug → Simulate Memory Warning)
///   -interrupt <s>        the app loses the screen for a second at <s> (a call's banner: resign active, then active)
///   -nan-input <s>        from <s>, Free Drive's input reads NaN for two seconds of ticks (a sensor's garbage)
enum Inject {
    static func corruptPrefsIfAsked() {
        guard Launch.args.contains("-corrupt-prefs") else { return }
        let d = UserDefaults.standard
        d.set("vapor", forKey: Look.key); d.set("moon", forKey: "cg.course"); d.set(7, forKey: "cg.tier"); d.set("feet", forKey: "cg.control")
    }
    @MainActor static func startIfAsked() {
        if let s = Launch.value("-memwarn").flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + s) {
                print("INJECT memory warning")
                NotificationCenter.default.post(name: UIApplication.didReceiveMemoryWarningNotification, object: UIApplication.shared)
            }
        }
        if let s = Launch.value("-interrupt").flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + s) {
                print("INJECT interruption")
                NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: UIApplication.shared)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
                }
            }
        }
        if let s = Launch.value("-nan-input").flatMap(Double.init) { nanFrom = Date().addingTimeInterval(s) }
    }
    nonisolated(unsafe) static var nanFrom: Date?
    nonisolated(unsafe) static var nanTicks = 480
    /// True for 480 drive ticks once the time has come (FreeDrive reads it into its input, a tick at a time).
    static func nanTick() -> Bool {
        guard let t = nanFrom, Date() >= t, nanTicks > 0 else { return false }
        nanTicks -= 1
        return true
    }
}
#endif
