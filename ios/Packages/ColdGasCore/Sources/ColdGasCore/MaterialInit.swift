// A Material made outside ColdGasCore (0330: the drive's own grounds, ColdGasPhysics Matter.swift). Additive: the courses'
// MATERIALS and the scored sim are unchanged.
extension Material {
    public init(drive id: String, grip: Double, slide: Double, bounce: Double, loose: Bool, roll: Double) {
        self.init(id: id, grip: grip, slide: slide, bounce: bounce, loose: loose, roll: roll)
    }
}
