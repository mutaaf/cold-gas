// Free Drive's loose things' own materials (0269). Not the web's (courses.js MATERIALS, ported line for line beside this):
// nothing scored touches these, only Free Drive and Roam's cones and barriers (ColdGasPhysics Loose.swift).
public extension MATERIALS {
    /// A road cone's recycled-rubber base: grips concrete and asphalt (rubber on dry concrete μ ≈ 0.6–0.85; the engine
    /// takes the lower of the two surfaces' values), a dull knock (restitution ≈ 0.25).
    static let rubber = Material(id: "rubber", grip: 0.8, slide: 0.8, bounce: 0.25, loose: false, roll: 0)
    /// A water-filled polyethylene barrier: HDPE on concrete slides at μ ≈ 0.3–0.4; the water inside soaks up the blow
    /// (restitution ≈ 0.05: it thuds, it doesn't bounce).
    static let hdpe = Material(id: "hdpe", grip: 0.35, slide: 0.35, bounce: 0.05, loose: false, roll: 0)
}
