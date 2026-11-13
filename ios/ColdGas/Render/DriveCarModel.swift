// The drive's own car, forged (0229): a detailed body (≈ 50 k triangles, a 10 k one for distance) and open spoked wheels on
// real tyres, built in Blender by tools/forge/car/build.py over the stage roadster's own skin, so every animated part of
// the roadster (the DRL bar, the lamps, the wing, the vanes, the skirts, the fans, the nozzles) still sits where it did.
// Free Drive and the roams draw it; the scored runs keep the stage's roadster. Pixels only: the physics never sees it.
// Resources/Car/car.json is stage.json's mesh format (Stage.parseMesh); the wheels are built for the car's right side
// (x < 0) and mirrored for its left.
import Foundation
import Metal

final class DriveCarModel {
    let body: StageMesh, bodyFar: StageMesh
    let frontSpin, frontSteer, rearSpin, rearSteer: StageMesh
    /// The side the wheels were built for (−1: x < 0); a wheel on the other side is drawn mirrored.
    let builtForX: Float
    /// Past this distance from the eye the lighter body is drawn.
    static let farAt: Float = 32

    init?(device: MTLDevice) {
        guard let dir = Bundle.main.url(forResource: "Car", withExtension: nil),
              let jd = try? Data(contentsOf: dir.appendingPathComponent("car.json")),
              let j = try? JSONSerialization.jsonObject(with: jd) as? [String: Any],
              let w = j["wheels"] as? [String: Any] else { return nil }
        func mesh(_ a: Any?) -> StageMesh? { (a as? [String: Any]).flatMap { Stage.parseMesh($0, dir: dir, device: device, texIndex: [:]) } }
        guard let b = mesh(j["body"]), let bf = mesh(j["bodyLod1"]), let fs = mesh(w["frontSpin"]), let ft = mesh(w["frontSteer"]),
              let rs = mesh(w["rearSpin"]), let rt = mesh(w["rearSteer"]) else { return nil }
        body = b; bodyFar = bf; frontSpin = fs; frontSteer = ft; rearSpin = rs; rearSteer = rt
        builtForX = (w["builtForX"] as? NSNumber)?.floatValue ?? -1
    }
}
