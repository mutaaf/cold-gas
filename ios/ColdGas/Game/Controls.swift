// The touches into the live run (0154): the pads call this on the main thread; LiveRun reads it once per tick.
import ColdGasPhysics

@MainActor
final class Controls {
    enum Key { case go, brake, lift, land }
    weak var live: LiveRun?
    /// Free Drive's controls (no run): the classic stick and pedals go to its sampler.
    weak var drive: InputSampler?
    private var touch: TouchControls? { live?.touch ?? drive?.touch }
    func thumbDown() { live?.thumb.down() }
    func thumbUp() { live?.thumb.up() }
    /// The held thumb's slide from where it pressed, points, +y up the glass.
    func thumbMove(dx: Double, dy: Double) { live?.thumb.move(dx, dy) }
    var thumbDriving: Bool { live?.thumb.driving ?? false }
    /// The knob, −1…1 each way, y + down the glass.
    func stick(x: Double, y: Double) {
        if x == 0 && y == 0 { touch?.stickUp() } else { touch?.stick(x, y) }
    }
    func press(_ k: Key, _ on: Bool) {
        guard let t = touch else { return }
        let b: TouchControls.Button = k == .go ? .go : k == .brake ? .brk : k == .lift ? .lift : .land
        if on { t.press(b) } else { t.release(b) }
    }
}
