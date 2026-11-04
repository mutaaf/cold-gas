// `-haptics demo [show|crash|wall|lineup]`: the JS sim's own flights (Tests/Vectors/haptics/*.json) played through
// HapticScore and Core Haptics in real time, 240 ticks a second, looping with a pause. Feel the run on a phone before
// the Swift sim lands (0149): the climb's rumble, the release, the hiss softening, the silent apex, four wheels
// touching, the crash. Add `-haptics-log` to print the track (the simulator can't play haptics).
import QuartzCore
import UIKit
import ColdGasCore

final class HapticDemo {
    static var running: HapticDemo?
    private let ticks: [HapticFeed]
    private let course: String
    private var score: HapticScore
    private var link: CADisplayLink?
    private var t0: CFTimeInterval = 0, done = 0
    private let player = HapticPlayer.shared

    static func startIfAsked() {
        guard let i = Launch.args.firstIndex(of: "-haptics"), i + 1 < Launch.args.count, Launch.args[i + 1] == "demo" else { return }
        let which = (i + 2 < Launch.args.count && !Launch.args[i + 2].hasPrefix("-")) ? Launch.args[i + 2] : "show"
        let file = ["show": "ref-show", "crash": "crash-show-carry5", "wall": "ref-wall", "lineup": "ref-lineup"][which] ?? "ref-show"
        guard let url = Bundle.main.url(forResource: file, withExtension: "json", subdirectory: "haptics"),
              let data = try? Data(contentsOf: url), let feed = HapticFeed.load(data) else { print("HAPTIC no feed \(file)"); return }
        running = HapticDemo(course: feed.course, ticks: feed.ticks)
        print("HAPTIC demo \(file): \(feed.ticks.count) ticks, engine \(HapticPlayer.shared.supported ? "on" : "unavailable (logging)") level \(HapticPlayer.shared.level.rawValue)")
    }

    private init(course: String, ticks: [HapticFeed]) {
        self.course = course; self.ticks = ticks
        score = HapticScore(course: course)
        let l = CADisplayLink(target: self, selector: #selector(frame(_:)))
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        l.add(to: .main, forMode: .common)
        link = l
    }

    @objc private func frame(_ l: CADisplayLink) {
        if t0 == 0 { t0 = l.timestamp }
        let due = min(ticks.count, Int((l.timestamp - t0) * 240))
        while done < due { score.step(ticks[done]); done += 1 }
        score.drain { player.play($0) }
        player.apply(score.continuous)
        if done % 24 == 0 || due == ticks.count {
            let phase = ["drive", "ramp", "air", "landed", "done"][Int(ticks[max(0, done - 1)].phase)]
            let c = score.continuous
            NotificationCenter.default.post(name: .frameStats, object: String(format: "HAPTICS %@ · demo %@\n%@ · rumble %.2f hiss %.2f grind %.2f", player.level.rawValue, course, phase, c.rumble, c.hiss, c.grind))
        }
        if due == ticks.count {
            player.apply(HapticContinuous())
            if l.timestamp - t0 > Double(ticks.count) / 240 + 2 {   // a 2 s pause, then again
                t0 = 0; done = 0; score = HapticScore(course: course)
                Ready.mark("haptics:loop")
            }
        }
    }
}
