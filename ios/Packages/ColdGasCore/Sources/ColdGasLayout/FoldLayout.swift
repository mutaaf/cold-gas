// Where the scene and the controls go on a screen that may fold (docs/NATIVE.md §5, 0148). Pure: no UIKit.
// The rules come from 18-0-duo-graphics' measurements on the iPhone Duo (docs/iphone-duo.md there):
//  - layout comes from the fold's reserved region, never the hinge angle (the angle drives effects only);
//  - flat and folded lay out the same (a flat Duo reports its fold as an inactive region at the same frame);
//  - the fold isn't in the middle of the safe area (the 84 pt side bar), so panels are cut at the region;
//  - the region's shape says which way it runs (the array order isn't documented).
// The same split as the web's src/fold.js: the scene above a horizontal fold, the scene leading a vertical one.

public struct LRect: Equatable, Sendable, CustomStringConvertible {
    public var x, y, w, h: Double
    public init(x: Double, y: Double, w: Double, h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
    public var maxX: Double { x + w }
    public var maxY: Double { y + h }
    public var description: String { "(\(x), \(y), \(w)×\(h))" }
}
public struct LInsets: Equatable, Sendable {
    public var top, left, bottom, right: Double
    public init(top: Double = 0, left: Double = 0, bottom: Double = 0, right: Double = 0) { self.top = top; self.left = left; self.bottom = bottom; self.right = right }
}

public enum Spread: String, Sendable { case single, columns, rows }

public struct FoldLayout: Equatable, Sendable {
    public var spread: Spread
    /// The 3D scene's viewport (full-bleed on one panel: it may run under the side bar, never across the fold).
    public var scene: LRect
    /// Where the HUD and the controls live (inside the safe area). For `single`, the safe area itself.
    public var controls: LRect
    /// The band nothing may draw across (nil without a fold).
    public var fold: LRect?
}

public enum Fold {
    /// The smallest panel the split will make (pt): narrower than this and the screen stays one panel.
    public static let minPanel = 300.0

    /// `bounds`: the window's size at origin 0; `safe`: its safe-area insets; `regions`: the division regions
    /// (active or not) in the same coordinates.
    public static func layout(width: Double, height: Double, safe: LInsets, regions: [LRect]) -> FoldLayout {
        let all = LRect(x: 0, y: 0, w: width, h: height)
        let safeRect = LRect(x: safe.left, y: safe.top, w: width - safe.left - safe.right, h: height - safe.top - safe.bottom)
        // The fold: a region that crosses the window edge to edge one way.
        let fold = regions.first { r in
            (r.h >= height - 1 && r.w < width / 2) || (r.w >= width - 1 && r.h < height / 2)
        }
        guard let f = fold else { return FoldLayout(spread: .single, scene: all, controls: safeRect, fold: nil) }
        if f.h >= height - 1 {
            // Vertical fold (book): the scene leads, the controls trail.
            let lead = LRect(x: 0, y: 0, w: f.x, h: height)
            let trail = LRect(x: f.maxX, y: safe.top, w: width - safe.right - f.maxX, h: height - safe.top - safe.bottom)
            guard lead.w - safe.left >= minPanel, trail.w >= minPanel else { return FoldLayout(spread: .single, scene: all, controls: safeRect, fold: f) }
            return FoldLayout(spread: .columns, scene: lead, controls: trail, fold: f)
        }
        // Horizontal fold (tabletop): the scene above, the controls below.
        let top = LRect(x: 0, y: 0, w: width, h: f.y)
        let bottom = LRect(x: safe.left, y: f.maxY, w: width - safe.left - safe.right, h: height - safe.bottom - f.maxY)
        guard top.h - safe.top >= minPanel * 0.6, bottom.h >= minPanel * 0.6 else { return FoldLayout(spread: .single, scene: all, controls: safeRect, fold: f) }
        return FoldLayout(spread: .rows, scene: top, controls: bottom, fold: f)
    }

    /// A debug pose's fold for simulators that can't fold (`-pose book|tabletop|flat|closed`): the 40 pt band
    /// where the Duo reports it, from the measured poses (x/y 455.5 on the 951 / 951 sides).
    public static func emulatedRegions(pose: String, width: Double, height: Double) -> [LRect] {
        switch pose {
        case "book", "flat": return width >= 2 * minPanel ? [LRect(x: width / 2 - 20, y: 0, w: 40, h: height)] : []
        case "tabletop": return height >= 2 * minPanel * 0.6 ? [LRect(x: 0, y: height / 2 - 20, w: width, h: 40)] : []
        default: return []
        }
    }
}
