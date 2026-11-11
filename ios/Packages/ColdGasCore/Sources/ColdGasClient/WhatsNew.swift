// What's new: the update modal's notes and when it shows (owner, 2026-11-10). One source per version:
// ios/release-notes/<MARKETING_VERSION>.md, bundled into the app, is TestFlight's What to Test, the App Store's What's New
// (from the second release) and this modal, so they can't drift. The shape the modal reads (release-notes/README.md):
//
//   # Cold Gas 1.0.0
//
//   The hero headline, one line.
//
//   An optional lede, one short paragraph.
//
//   ## Highlights
//   - **A few words.** One short line. <!-- icon: sf.symbol.name -->     (2 to 4 of these: the callout cards)
//   - **A few words.** One short line. <!-- icon: gearshape, go: settings -->   (go: the screen the card opens)
//
//   ## Any other heading
//   Paragraphs and bullets: the full notes, folded under the cards.
//
// HTML comments never reach TestFlight or the store (scripts/asc.mjs strips them), so the icons live there.
import Foundation

/// Where a callout card takes you: a screen the title opens (RootUI.Sheet in the app maps each case, exhaustively).
/// A card about something with no screen of its own (the cameras, the sky) has none and stays plain.
public enum WhatsNewDestination: String, CaseIterable, Equatable, Sendable {
    case board, settings, howTo, practice
}

public struct ReleaseNotes: Equatable, Sendable {
    public struct Callout: Equatable, Sendable {
        public let icon: String
        public let title: String
        public let line: String
        /// `go:` in the card's comment: the screen it opens, or nil (an unknown name is nil too: a plain card).
        public let go: WhatsNewDestination?
        public init(icon: String, title: String, line: String, go: WhatsNewDestination? = nil) {
            self.icon = icon; self.title = title; self.line = line; self.go = go
        }
    }
    public struct Section: Equatable, Sendable {
        public let title: String
        /// Each entry is one paragraph or one bullet (bullets keep a leading "• ").
        public let lines: [String]
    }
    public let title: String
    public let headline: String
    public let lede: String
    public let callouts: [Callout]
    public let sections: [Section]

    public static let highlightsHeading = "highlights"
    public static let defaultIcon = "sparkles"

    /// Parse a notes file. Nil when it has no headline or fewer than two callouts: the modal then doesn't show.
    public static func parse(_ markdown: String) -> ReleaseNotes? {
        var title = "", intro: [String] = [], callouts: [Callout] = [], sections: [Section] = []
        var current: (title: String, lines: [String])? = nil
        var para: [String] = []
        func flushPara() {
            guard !para.isEmpty else { return }
            let p = para.joined(separator: " ")
            para = []
            if let c = current { current = (c.title, c.lines + [p]) } else { intro.append(p) }
        }
        func flushSection() {
            flushPara()
            if let c = current, c.title.lowercased() != highlightsHeading { sections.append(Section(title: c.title, lines: c.lines)) }
            current = nil
        }
        for raw in markdown.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("# ") { flushPara(); title = clean(String(line.dropFirst(2))); continue }
            if line.hasPrefix("## ") { flushSection(); current = (clean(String(line.dropFirst(3))), []); continue }
            if line.isEmpty { flushPara(); continue }
            if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flushPara()
                let item = String(line.dropFirst(2))
                if let c = current, c.title.lowercased() == highlightsHeading {
                    if let co = callout(item) { callouts.append(co) }
                } else if let c = current {
                    current = (c.title, c.lines + ["• " + clean(item)])
                } else {
                    intro.append("• " + clean(item))
                }
                continue
            }
            para.append(line)
        }
        flushSection()
        let paras = intro.map(clean).filter { !$0.isEmpty }
        guard let headline = paras.first, callouts.count >= 2 else { return nil }
        return ReleaseNotes(title: title, headline: headline, lede: paras.dropFirst().joined(separator: " "),
                            callouts: Array(callouts.prefix(4)), sections: sections)
    }

    /// `**Title.** Line <!-- icon: name, go: screen -->` → a card.
    static func callout(_ item: String) -> Callout? {
        var icon = defaultIcon, go: WhatsNewDestination? = nil
        if let r = item.range(of: #"<!--[^>]*\bgo:\s*[A-Za-z]+[^>]*-->"#, options: .regularExpression),
           let n = item[r].range(of: #"go:\s*[A-Za-z]+"#, options: .regularExpression) {
            go = WhatsNewDestination(rawValue: item[r][n].dropFirst(3).trimmingCharacters(in: .whitespaces))
        }
        if let r = item.range(of: #"<!--\s*icon:\s*[A-Za-z0-9.]+[^>]*-->"#, options: .regularExpression) {
            let tag = String(item[r])
            if let n = tag.range(of: #"icon:\s*[A-Za-z0-9.]+"#, options: .regularExpression) {
                icon = tag[n].replacingOccurrences(of: "icon:", with: "").trimmingCharacters(in: .whitespaces)
            }
        }
        let text = stripComments(item)
        guard let open = text.range(of: "**"), let close = text.range(of: "**", range: open.upperBound..<text.endIndex) else { return nil }
        var t = String(text[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespaces)
        if t.hasSuffix(".") { t.removeLast() }
        let line = clean(String(text[close.upperBound...]))
        guard !t.isEmpty, !line.isEmpty else { return nil }
        return Callout(icon: icon, title: t, line: line, go: go)
    }

    static func stripComments(_ s: String) -> String {
        s.replacingOccurrences(of: #"<!--[\s\S]*?-->"#, with: "", options: .regularExpression)
    }
    /// Markdown emphasis and code out, as scripts/asc.mjs strips it for TestFlight.
    static func clean(_ s: String) -> String {
        stripComments(s)
            .replacingOccurrences(of: #"\*\*(.+?)\*\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\*([^*]+)\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }
}

/// When the modal shows: once after the app updates to a version with notes. Never on a fresh install (the first launch
/// records its version as seen), never twice for one version, never under a test, a capture or a debug tool.
public enum WhatsNewGate {
    public struct Decision: Equatable, Sendable {
        public let show: Bool
        /// The version to record as seen now, or nil to leave the record alone.
        public let record: String?
    }

    /// `forced` (DEBUG `-whatsNew`: shots, review, a look on a phone) shows the notes and records nothing, so the real
    /// once-per-version gate is untouched for the next ordinary launch.
    public static func decide(current: String, seen: String?, quiet: Bool, hasNotes: Bool, forced: Bool = false) -> Decision {
        if forced { return Decision(show: hasNotes, record: nil) }
        if quiet { return Decision(show: false, record: nil) }                   // a test or a tool: touch nothing
        guard let seen, !seen.isEmpty else { return Decision(show: false, record: current) }   // a fresh install
        if seen == current { return Decision(show: false, record: nil) }
        // An update (or a step back to an older build): it's seen from now on, shown only going forward with notes.
        return Decision(show: hasNotes && isNewer(current, than: seen), record: current)
    }

    /// "1.0.10" > "1.0.9"; missing parts count as 0.
    public static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }, pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// The app's own launch flags are lowercase after the dash (-bench, -selftest, -replay, -cam-log, -timescale, -window,
    /// -pose, -course, -uitest…: the scripts, the store captures and the UI tests). Any of them means a tool or a test is
    /// driving the app, so the modal stays away. The system's own (-NSDocumentRevisionsDebugMode, -AppleLanguages,
    /// -com.apple.…) don't count, and neither does -whatsNew, the DEBUG flag that forces the modal.
    public static func isQuiet(arguments: [String], environment: [String: String]) -> Bool {
        if environment["XCTestConfigurationFilePath"] != nil || environment["XCTestSessionIdentifier"] != nil { return true }
        for a in arguments.dropFirst() where a.hasPrefix("-") && a != forceFlag {
            guard let c = a.dropFirst().first, c.isLowercase, !a.contains(".") else { continue }
            return true
        }
        return false
    }
    public static let forceFlag = "-whatsNew"
    public static let seenKey = "coldgas.whatsnew.seen"
}
