// Share (0252): a picture of the moment and the challenge. The card is drawn on the device, off the frame loop (the run is
// over, the results are up): a 1080×1350 playbill of the jump, its stunt name (ColdGasClient's StuntName, the web's 0260
// rules), the score and the verdict, three numbers, your best beside it, the flight's line as the car flew it (from the
// replay track), and the short link. Original art only (§3.7): the app's type and one signal red. The share sends the
// picture, one line and the challenge link (Challenge.encode: it opens the same jump in the app or on the web).
import SwiftUI
import UIKit
import ColdGasClient
import ColdGasCore
import ColdGasPhysics

extension RunResult {
    private func fact(_ k: String) -> Value? { card.flat.first { $0.0 == "facts." + k }?.1 }
    private func num(_ k: String) -> Double? { if case let .n(v)? = fact(k) { return v }; return nil }
    private func bool(_ k: String) -> Bool { if case let .b(v)? = fact(k) { return v }; return false }
    var stunt: StuntName.Facts {
        StuntName.Facts(course: course, rotations: num("rotations") ?? 0, crashed: !landed, crossedRow: bool("crossedRow"), padMiss: num("padMiss"))
    }
    /// What a share links to: this jump as a challenge (any flown run, a wreck too), else the game.
    var shareURL: URL {
        if drill == nil, let p = try? Challenge.encode(log: log, course: course, score: card.total, tier: card.tier, initials: SaveStore.shared.initials, simVersion: SIM_VERSION),
           let u = URL(string: Challenge.url(base: "https://mutaafaziz.com/coldgas/", course: course, payload: p)) { return u }
        return URL(string: "https://mutaafaziz.com/coldgas/")!
    }
}

struct ShareCardView: View {
    let result: RunResult
    let path: [CGPoint]          // the flight, side on: x along the course, y up (metres)
    let best: Double?
    var body: some View {
        let card = result.card, f = result.stunt, landed = result.landed
        let parts = StuntName.parts(f)
        ZStack(alignment: .topLeading) {
            Theme.bg
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("COLD GAS").font(Theme.marquee(30)).tracking(18).foregroundStyle(Theme.ink2)
                    Spacer()
                    Text(card.tier.uppercased()).font(Theme.text(28, .semibold)).tracking(5)
                        .foregroundStyle(card.tier == "assist" ? Theme.ink2 : Theme.amber)
                }
                Rectangle().fill(Theme.hair).frame(height: 2).padding(.top, 34)
                Text(parts.first?.uppercased() ?? "").font(Theme.marquee(92)).foregroundStyle(Theme.ink).padding(.top, 54)
                    .lineLimit(1).minimumScaleFactor(0.5)
                if parts.count > 1 {
                    HStack(spacing: 18) {
                        Capsule().fill(Theme.signal).frame(width: 56, height: 4)
                        Text(parts.dropFirst().joined(separator: "  \u{00B7}  ").uppercased()).font(Theme.text(38, .semibold)).tracking(6).foregroundStyle(Theme.ink)
                    }.padding(.top, 14)
                }
                // The line the car flew, the apex in red, the touchdown a tick on the ground line: its own band.
                FlightLine(path: path, landed: landed).frame(maxWidth: .infinity, maxHeight: .infinity).padding(.vertical, 36)
                HStack(alignment: .firstTextBaseline, spacing: 14) {
                    Text(String(format: "%.1f", card.total)).font(Theme.mono(200, bold: true)).foregroundStyle(Theme.ink).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text("/ 100").font(Theme.mono(40)).foregroundStyle(Theme.ink3)
                    Spacer()
                    if let b = best {
                        VStack(alignment: .trailing, spacing: 4) {
                            Text(b <= card.total ? "NEW BEST" : String(format: "%.1f", b)).font(Theme.mono(40)).foregroundStyle(b <= card.total ? Theme.signal : Theme.ink)
                            if b > card.total { Text("BEST").font(Theme.text(22, .medium)).tracking(4).foregroundStyle(Theme.ink3) }
                        }
                    }
                }
                Text(card.verdict.uppercased()).font(Theme.marquee(40, .headline)).tracking(3).foregroundStyle(Theme.ink).padding(.top, 2)
                    .lineLimit(2).minimumScaleFactor(0.6)
                HStack(spacing: 0) {
                    stat("APEX", Fmt.length(max(0, result.telemetry.apex - SPEC.comHeight)) + " " + Fmt.lengthUnit)
                    stat("SINK", Fmt.rate(result.telemetry.sink) + " " + Fmt.rateUnit)
                    stat("TILT", String(format: "%.0f°", result.telemetry.tiltDeg))
                }.padding(.top, 44)
                Rectangle().fill(Theme.hair).frame(height: 2).padding(.top, 44)
                HStack {
                    Text(landed ? "BEAT IT" : "LAND IT").font(Theme.text(28, .semibold)).tracking(6).foregroundStyle(Theme.signal)
                    Spacer()
                    Text("mutaafaziz.com/coldgas").font(Theme.mono(30)).foregroundStyle(Theme.ink2)
                }.padding(.top, 30)
            }
            .padding(80)
        }
        .frame(width: 1080, height: 1350)
        .environment(\.colorScheme, .dark)
    }
    private func stat(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(k).font(Theme.text(22, .medium)).tracking(5).foregroundStyle(Theme.ink3)
            Text(v).font(Theme.mono(44)).foregroundStyle(Theme.ink)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The flight's side elevation, scaled to fit: a hairline, the apex, the touchdown.
private struct FlightLine: View {
    let path: [CGPoint]
    let landed: Bool
    var body: some View {
        Canvas { ctx, size in
            guard path.count > 2 else { return }
            let xs = path.map(\.x), ys = path.map(\.y)
            let x0 = xs.min() ?? 0, x1 = xs.max() ?? 1, y0 = min(0, ys.min() ?? 0), y1 = ys.max() ?? 1
            let k = min(size.width / max(1, x1 - x0), size.height / max(1, y1 - y0))
            let ox = (size.width - (x1 - x0) * k) / 2
            func pt(_ p: CGPoint) -> CGPoint { CGPoint(x: ox + (p.x - x0) * k, y: size.height - (p.y - y0) * k) }
            var ground = Path(); ground.move(to: CGPoint(x: 0, y: size.height - (0 - y0) * k)); ground.addLine(to: CGPoint(x: size.width, y: size.height - (0 - y0) * k))
            ctx.stroke(ground, with: .color(Theme.hair2), lineWidth: 2)
            var line = Path(); line.move(to: pt(path[0])); for p in path.dropFirst() { line.addLine(to: pt(p)) }
            ctx.stroke(line, with: .color(Theme.ink2), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            if let apex = path.max(by: { $0.y < $1.y }) {
                let a = pt(apex)
                ctx.fill(Path(ellipseIn: CGRect(x: a.x - 9, y: a.y - 9, width: 18, height: 18)), with: .color(Theme.signal))
            }
            if let end = path.last {
                let e = pt(end)
                var t = Path(); t.move(to: CGPoint(x: e.x, y: e.y - 22)); t.addLine(to: CGPoint(x: e.x, y: e.y + 22))
                ctx.stroke(t, with: .color(landed ? Theme.ink : Theme.amber), lineWidth: 4)
            }
        }
    }
}

/// Renders the card and opens the share sheet with the picture, the line and the link. share_tap on the press,
/// share_done when the sheet says it went (0246's vocabulary).
@MainActor
enum Sharer {
    static func image(_ r: RunResult) -> UIImage? {
        let view = ShareCardView(result: r, path: Game.shared.flightPath(), best: Records.shared.best(r.course))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        renderer.isOpaque = true
        return renderer.uiImage
    }
    static func share(_ r: RunResult, from anchor: CGRect? = nil) {
        Usage.shared.track("share_tap", ["course": .text(r.course)])
        let t0 = CACurrentMediaTime()
        let img = image(r)
        print(String(format: "SHARE card %.0f ms", (CACurrentMediaTime() - t0) * 1000))
        let text = StuntName.message(score: r.card.total, r.stunt)
        var items: [Any] = [text + " " + r.shareURL.absoluteString]
        if let img { items.insert(img, at: 0) }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.completionWithItemsHandler = { type, done, _, _ in
            guard done else { return }
            Usage.shared.track("share_done", ["course": .text(r.course), "via": .text(type == .copyToPasteboard ? "copy" : img == nil ? "link" : "file")])
        }
        guard let root = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else { return }
        var top = root
        while let p = top.presentedViewController { top = p }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = anchor ?? CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 120, width: 1, height: 1)
        }
        top.present(vc, animated: true)
        Ready.mark("share-sheet")
    }
}
