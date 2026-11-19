// The app's inputs from outside the sim, held to what they're allowed to be (0301; docs/AUDIT-2026-11-18.md "Hardened").
// A stored setting the app no longer knows (an old build's value, a hand-edited plist, a bad migration), a number that
// isn't one, a frame clock that jumped: each is repaired to the default here, in pure code the tests hold, and the caller
// reports it once. Nothing here is the scored sim's: a run's inputs are its log of integers, and its vectors don't move.
import Foundation

public enum Guard {
    /// A stored choice that must be one of `allowed`: the value when it is, else `fallback`, and whether it was repaired.
    /// A missing value isn't a repair (a fresh install has none).
    public static func oneOf(_ raw: String?, _ allowed: [String], fallback: String) -> (value: String, repaired: Bool) {
        guard let raw else { return (fallback, false) }
        return allowed.contains(raw) ? (raw, false) : (fallback, true)
    }
    /// A stored number that must be finite and inside `range`: clamped into it; not a number (or not finite) is `fallback`.
    public static func number(_ x: Double?, in range: ClosedRange<Double>, fallback: Double) -> (value: Double, repaired: Bool) {
        guard let x else { return (fallback, false) }
        guard x.isFinite else { return (fallback, true) }
        let c = min(range.upperBound, max(range.lowerBound, x))
        return (c, c != x)
    }
    /// A frame's time step (seconds): finite, never negative, and never more than `cap` (the sim's own cap is 0.1 s; a
    /// longer step was the app away, not a frame). NaN and infinities are a step of nothing.
    @inline(__always) public static func step(_ dt: Double, cap: Double = 1) -> Double {
        dt.isFinite ? min(cap, max(0, dt)) : 0
    }
    /// A rate (the crash's slow motion): finite, 0…`cap`; NaN is 1 (real time), the safe default.
    @inline(__always) public static func rate(_ k: Double, cap: Double = 4) -> Double {
        k.isFinite ? min(cap, max(0, k)) : 1
    }
    /// A list that only grows (a drive's impacts): how many to drop from its front once it passes `max`, keeping `keep`.
    @inline(__always) public static func overflow(count: Int, max: Int, keep: Int) -> Int { count > max ? count - Swift.max(0, keep) : 0 }
    /// An index cursor into such a list after `dropped` more were taken from its front: the same element, or the start.
    @inline(__always) public static func cursor(_ cursor: Int, count: Int, dropped: Int) -> Int { Swift.max(0, Swift.min(count, cursor - Swift.max(0, dropped))) }
    /// A value that must be finite: `fallback` otherwise.
    @inline(__always) public static func finite(_ x: Double, _ fallback: Double = 0) -> Double { x.isFinite ? x : fallback }
    @inline(__always) public static func finite(_ x: Float, _ fallback: Float = 0) -> Float { x.isFinite ? x : fallback }
}
