// The app's entry (UIScene: required on the iOS 27 SDK). docs/NATIVE.md §7.
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        setvbuf(stdout, nil, _IOLBF, 0)   // the scripts read stdout through a pipe: one line at a time
        Ready.clear()
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
    }
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
