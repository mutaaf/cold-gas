// A session's performance and feature use, said in a few coarse words (0300; docs/AUDIT-2026-11-18.md "Instrumented").
// The pure half: the meter the display link feeds once a frame (allocation-free, NaN-proof), the summary it cuts at a quiet
// moment, and the words that carry it in the existing `/obs` batch. The sender (ColdGas/App/Instruments.swift) only feeds it
// and hands the summary to the health queue (Obs.Queue), which sends it beside the faults, behind the same Settings →
// Privacy switch, never during a countdown, a run or a replay.
//
// What a summary is: the session's frame intervals as the web's histogram (src/obs/frames.js EDGES, so the Worker's
// `obs_frames` takes it as is), hitches (a frame over 50 ms, the web's HITCH_MS), two-second windows under 30 fps, frames
// that lost sim time, the share of frames at 120 Hz, the mean render scale, the look most drawn, the peak thermal state,
// the peak memory footprint and the launch time, each folded into a bucket. Nothing names the device or the player: the
// device class stays the constant "phone-hi", and the build is the app's.
//
// The feature-use half: which of the new features a session touched (the looks chosen, the driving aids switched, the
// handbrake pulled, a roam and its challenges, Wreck Club opened…), as flags, never counts or times.
import Foundation

public enum Perf {
    /// src/obs/frames.js EDGES (ms): bucket i holds intervals ≤ EDGES[i]; the last holds everything over 250 ms.
    public static let EDGES: [Double] = [6, 9, 12, 15, 17.5, 20, 25, 33.4, 50, 66.7, 100, 250]
    public static let NB = 13
    /// src/obs/frames.js HITCH_MS, LOW_FPS_MS, WINDOW_MS.
    public static let HITCH_MS = 50.0, LOW_FPS_MS = 33.4, WINDOW_MS = 2000.0
    /// An interval longer than this isn't a frame (the app was away, the debugger paused it): not counted at all.
    public static let AWAY_MS = 1000.0
    /// The sim's frame step is capped at 0.1 s (Game.frame): a longer interval lost sim time.
    public static let DROP_MS = 100.0
    /// A summary needs this many frames (≈10 s at 120 Hz): a launch straight into the background says nothing.
    public static let MIN_FRAMES = 1200
    /// The Worker's caps (cleanObs: each bucket ≤ 1e6, n ≤ 1e6).
    public static let MAX_FRAMES = 1_000_000

    public static func bucket(_ ms: Double) -> Int {
        var i = 0
        while i < EDGES.count && ms > EDGES[i] { i += 1 }
        return i
    }
    /// The q-quantile of a histogram, linear within the bucket (src/obs/frames.js percentile, to 0.1 ms).
    public static func percentile(_ h: [Int], _ q: Double) -> Double {
        let n = h.reduce(0, +)
        guard n > 0 else { return 0 }
        let target = q * Double(n)
        var acc = 0.0
        for i in 0..<h.count {
            let c = Double(h[i])
            if acc + c >= target && c > 0 {
                let lo = i == 0 ? 0 : EDGES[i - 1], hi = i < EDGES.count ? EDGES[i] : 1000
                return ((lo + ((target - acc) / c) * (hi - lo)) * 10).rounded() / 10
            }
            acc += c
        }
        return EDGES[EDGES.count - 1]
    }

    // --- the meter --------------------------------------------------------------------------------------
    /// Fed once a frame from the display link. A value type with fixed storage: `frame` never allocates.
    public struct Meter: Equatable, Sendable {
        public private(set) var hist = [Int](repeating: 0, count: NB)
        public private(set) var frames = 0, hitches = 0, low = 0, drop = 0
        public private(set) var at120 = 0
        public private(set) var scaleSum = 0.0
        /// Frames per look (Real, Anime, 8-bit), in Look's order.
        public private(set) var looks = [0, 0, 0]
        public private(set) var thermalPeak = 0
        public private(set) var memPeakMB = 0
        public private(set) var launchMs: Int?
        /// Scored runs, drives and replays this session (a summary of a session spent on the title says less).
        public private(set) var runs = 0
        private var winMs = 0.0, winFrames = 0
        public init() {}

        /// One presented frame: `ms` since the last one, the cadence asked for, the render scale and the look's index.
        public mutating func frame(ms: Double, cadence: Int, scale: Double, look: Int) {
            guard ms.isFinite, ms > 0, ms < AWAY_MS, frames < MAX_FRAMES else { return }
            hist[Perf.bucket(ms)] += 1
            frames += 1
            if ms > HITCH_MS { hitches += 1 }
            if ms > DROP_MS { drop += 1 }
            if cadence >= 90 { at120 += 1 }
            if scale.isFinite { scaleSum += min(2, max(0, scale)) }
            if look >= 0 && look < 3 { looks[look] += 1 }
            winMs += ms; winFrames += 1
            if winMs >= WINDOW_MS {
                if winMs / Double(winFrames) > LOW_FPS_MS { low += 1 }
                winMs = 0; winFrames = 0
            }
        }
        /// ProcessInfo.ThermalState's raw value (nominal 0 … critical 3); the peak is kept.
        public mutating func thermal(_ raw: Int) { thermalPeak = max(thermalPeak, min(3, max(0, raw))) }
        /// The footprint now, in bytes; the peak is kept (in MB).
        public mutating func memory(bytes: UInt64) { memPeakMB = max(memPeakMB, Int(min(bytes / 1_048_576, 1_000_000))) }
        /// The process's start to its first frame. Kept once per launch; nonsense (negative, over ten minutes) is dropped.
        public mutating func launch(ms: Double) {
            guard launchMs == nil, ms.isFinite, ms > 0, ms < 600_000 else { return }
            launchMs = Int(ms.rounded())
        }
        public mutating func run() { runs = min(runs + 1, 10_000) }

        /// The session so far, or nil when it's too short to say anything. `reset()` after.
        public func summary(build: String) -> Summary? {
            guard frames >= MIN_FRAMES else { return nil }
            let lookI = looks.firstIndex(of: looks.max() ?? 0) ?? 0
            return Summary(build: build, hist: hist, frames: frames, hitches: hitches, low: low, drop: drop,
                           share120: Double(at120) / Double(frames), scale: scaleSum / Double(frames),
                           look: Summary.LOOKS[lookI], thermal: thermalPeak, memMB: memPeakMB, launchMs: launchMs, runs: runs)
        }
        /// A new session's meter, keeping the launch (it's sent with the first summary only) and nothing else.
        public mutating func reset() { self = Meter() }
    }

    // --- the summary --------------------------------------------------------------------------------------
    public struct Summary: Codable, Equatable, Sendable {
        public static let LOOKS = ["real", "anime", "pixel"]
        public static let THERMAL = ["nominal", "fair", "serious", "critical"]
        public var build: String
        public var hist: [Int]
        public var frames: Int, hitches: Int, low: Int, drop: Int
        public var share120: Double, scale: Double
        public var look: String
        public var thermal: Int, memMB: Int
        public var launchMs: Int?
        public var runs: Int

        public var p50: Double { Perf.percentile(hist, 0.5) }
        public var p95: Double { Perf.percentile(hist, 0.95) }
        public var hitchesPerK: Double { frames > 0 ? Double(hitches) * 1000 / Double(frames) : 0 }

        /// The frame-time histogram as `/obs` takes it (cleanObs `fr`: 13 buckets, n = their sum, hitch ≤ n, low ≤ n).
        public var fr: [String: Any] {
            let h = hist.count == NB ? hist.map { min(max(0, $0), 1_000_000) } : [Int](repeating: 0, count: NB)
            let n = h.reduce(0, +)
            return ["h": h, "n": n, "hitch": min(max(0, hitches), n), "low": min(max(0, low), n), "drop": min(max(0, drop), 10_000_000)]
        }

        /// The summary in words that survive the Worker's message normalisation (numbers fold to N there, so every value is a
        /// bucket glued to its name with `_`: `p95_12` is "p95 within 12 ms"). Coarse on purpose: a few distinct rows a build.
        public var message: String {
            let p50E = Perf.edgeWord(p50), p95E = Perf.edgeWord(p95)
            let hz = share120 >= 0.9 ? "hz120" : share120 <= 0.1 ? "hz60" : "hzmix"
            let sc = "scale_\(Int(((scale.isFinite ? scale : 0) * 10).rounded()) * 10)"
            let heat = "heat_\(Summary.THERMAL[min(3, max(0, thermal))])"
            return ["perf", "p50_\(p50E)", "p95_\(p95E)", "hitch_\(Perf.hitchWord(hitchesPerK))", hz, "look_\(look)", sc, heat,
                    "mem_\(Perf.memWord(memMB))", "launch_\(launchMs.map(Perf.launchWord) ?? "none")"].joined(separator: " ")
        }
    }

    /// A time's bucket by its upper edge, as a word: 17.5 → "17", over 250 → "inf".
    static func edgeWord(_ ms: Double) -> String {
        let i = bucket(ms)
        return i < EDGES.count ? String(Int(EDGES[i])) : "inf"
    }
    static func hitchWord(_ perK: Double) -> String { perK <= 0 ? "none" : perK < 1 ? "lt1" : perK < 5 ? "lt5" : perK < 20 ? "lt20" : "many" }
    static func memWord(_ mb: Int) -> String { mb <= 0 ? "none" : mb < 300 ? "lt300" : mb < 500 ? "lt500" : mb < 800 ? "lt800" : mb < 1200 ? "lt1200" : "big" }
    static func launchWord(_ ms: Int) -> String { ms < 1000 ? "lt1s" : ms < 2000 ? "lt2s" : ms < 4000 ? "lt4s" : "slow" }

    /// The frame a summary row carries: `perf@<build>`, so each build is its own row in the digest (the key is msg + frame).
    public static func frame(_ kind: String, build: String) -> String {
        let b = String(build.filter { $0.isASCII && ($0.isLetter || $0.isNumber || "_.-".contains($0)) }.prefix(48))
        return "\(kind)@\(b.isEmpty ? "unknown" : b)"
    }

    // --- feature use ------------------------------------------------------------------------------------
    /// The new features a session can touch. A flag each: set once, whatever the count.
    public enum Feature: String, Codable, CaseIterable, Sendable {
        case lookReal = "look_real", lookAnime = "look_anime", lookPixel = "look_pixel"
        case escOn = "esc_on", escSport = "esc_sport", escOff = "esc_off"
        case absOn = "abs_on", absOff = "abs_off", tractionOn = "tc_on", tractionOff = "tc_off"
        case driftOn = "drift_on", driftOff = "drift_off", brakeBias = "bias", handbrake = "hb"
        case roam, roamChallenge = "roamch", roamReset = "roamreset", drive, replay, club
    }
    /// The features a session touched, in a fixed order (so equal sets are equal words).
    public struct Use: Codable, Equatable, Sendable {
        public private(set) var flags: Set<Feature> = []
        public init() {}
        public mutating func note(_ f: Feature) { flags.insert(f) }
        public var isEmpty: Bool { flags.isEmpty }
        /// "use look_anime drift_off roam roamch", or nil when nothing was touched.
        public var message: String? {
            guard !flags.isEmpty else { return nil }
            return (["use"] + Feature.allCases.filter(flags.contains).map(\.rawValue)).joined(separator: " ")
        }
    }
}
