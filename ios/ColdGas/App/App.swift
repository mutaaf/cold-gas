// The app's entry (UIScene: required on the iOS 27 SDK). docs/NATIVE.md §7.
import UIKit
import ColdGasClient

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        setvbuf(stdout, nil, _IOLBF, 0)   // the scripts read stdout through a pipe: one line at a time
        Ready.clear()
        Signs.begin(.launch)        // 0300: ends at the first frame drawn (PerfCenter)
        Usage.launchedAt = Date()   // first_input's clock (0246)
        Theme.registerFonts()
        return true
    }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let ws = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: ws)
        w.rootViewController = RootViewController()
        w.makeKeyAndVisible()
        window = w
        if Launch.selftest { SelfTest.runInBackground() }
        _ = HapticPlayer.shared          // the engine is started at launch, never on the first event
        HapticDemo.startIfAsked()
        SoundLab.startIfAsked()
        Usage.shared.sessionStart()      // 0246: queued now, sent from the title
        Report.start()                   // 0293: MetricKit, and what the save found at launch
        // 0253: a link that launched the app (a universal link's activity, or coldgas://), once the game is up.
        let urls = connectionOptions.urlContexts.map(\.url) + connectionOptions.userActivities.compactMap(\.webpageURL)
        #if DEBUG
        let forced = Launch.value("-open").flatMap(URL.init(string:)).map { [$0] } ?? []   // the UI tests and the shots
        #else
        let forced: [URL] = []
        #endif
        if let u = (urls + forced).first { DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { Game.shared.open(url: u) } }
    }
    /// A universal link while the app is running.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let u = userActivity.webpageURL { Game.shared.open(url: u) }
    }
    /// coldgas:// while the app is running.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let u = URLContexts.first?.url { Game.shared.open(url: u) }
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        PerfCenter.shared.cut(force: true)   // 0300: the session's summary joins the health queue (sent from a quiet screen)
        Usage.shared.didEnterBackground()
    }
    func sceneWillEnterForeground(_ scene: UIScene) { Usage.shared.willEnterForeground() }
}

/// Launch arguments (debug tools for the simulator, the shots and the bench; docs/NATIVE.md §8).
enum Launch {
    static let args = ProcessInfo.processInfo.arguments
    static func value(_ flag: String) -> String? { args.firstIndex(of: flag).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } }
    /// `-pose closed|book|tabletop|flat`: a fold for simulators that can't fold (layout only).
    static let pose = value("-pose")
    /// `-window WxH`: lay out as a window of that size (scaled to fit), to shoot a pose on any screen.
    static let window: CGSize? = value("-window").flatMap { s in
        let p = s.split(separator: "x").compactMap { Double($0) }
        return p.count == 2 ? CGSize(width: p[0], height: p[1]) : nil
    }
    static let bench = args.contains("-bench")
    /// `-freedrive`: straight into Free Drive (docs/NATIVE-FREEDRIVE.md); with `-bench`, the drive's bench.
    static let freedrive = args.contains("-freedrive")
    static let selftest = args.contains("-selftest")
    /// `-mute` (Debug only): a simulator never makes a sound on the Mac (the owner's rule, 2026-11-16). The audio engine is
    /// never started and the master stays at 0, whatever Settings say; `-sound-capture` still records through its tap, silently.
    /// Every capture script passes it (sim.sh, look-shots.sh, store-capture.py, shots.sh, …). Honoured in Debug and in any
    /// simulator build (the Release benches run there too); a device's Release build, the one that ships, ignores it.
    #if DEBUG || targetEnvironment(simulator)
    static let mute = args.contains("-mute")
    #else
    static let mute = false
    #endif
}

/// Readiness tokens for the shots harness: Library/Caches/coldgas.ready gets a line per milestone
/// ("frame", "selftest:ok"…) so scripts wait for a token instead of sleeping (moon-club's pattern).
enum Ready {
    static let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("coldgas.ready")
    static func clear() { try? FileManager.default.removeItem(at: url) }
    static func mark(_ token: String) {
        let line = Data((token + "\n").utf8)
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(line); try? h.close() }
        else { try? line.write(to: url) }
        print("READY \(token)")
    }
}
