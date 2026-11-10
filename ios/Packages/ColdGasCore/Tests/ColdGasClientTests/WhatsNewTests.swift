// What's new: once per version after an update, never on a fresh install or under a test or a tool, and the current
// version's notes (ios/release-notes/<MARKETING_VERSION>.md, the file the app bundles) have the modal's shape.
import Foundation
import Testing
@testable import ColdGasClient

@Suite struct WhatsNewOnce {
    @Test func aFreshInstallRecordsTheVersionAndShowsNothing() {
        let d = WhatsNewGate.decide(current: "1.0.1", seen: nil, quiet: false, hasNotes: true)
        #expect(d == .init(show: false, record: "1.0.1"))
        #expect(WhatsNewGate.decide(current: "1.0.1", seen: "", quiet: false, hasNotes: true).show == false)
    }
    @Test func anUpdateShowsOnceThenNeverForThatVersion() {
        var seen: String? = nil
        func launch(_ v: String) -> Bool {
            let d = WhatsNewGate.decide(current: v, seen: seen, quiet: false, hasNotes: true)
            if let r = d.record { seen = r }
            return d.show
        }
        #expect(!launch("1.0.0"))      // installed
        #expect(!launch("1.0.0"))      // same version
        #expect(launch("1.0.1"))       // updated: once
        #expect(!launch("1.0.1"))
        #expect(!launch("1.0.1"))
        #expect(launch("1.1.0"))       // the next update: once again
        #expect(!launch("1.1.0"))
    }
    @Test func theSameVersionShowsNothing() {
        #expect(WhatsNewGate.decide(current: "1.0.0", seen: "1.0.0", quiet: false, hasNotes: true) == .init(show: false, record: nil))
    }
    @Test func noNotesOrAStepBackShowsNothingButIsRecorded() {
        #expect(WhatsNewGate.decide(current: "1.0.1", seen: "1.0.0", quiet: false, hasNotes: false) == .init(show: false, record: "1.0.1"))
        #expect(WhatsNewGate.decide(current: "1.0.0", seen: "1.0.1", quiet: false, hasNotes: true) == .init(show: false, record: "1.0.0"))
    }
    @Test func versionsCompareAsNumbers() {
        #expect(WhatsNewGate.isNewer("1.0.10", than: "1.0.9")); #expect(WhatsNewGate.isNewer("1.1", than: "1.0.9"))
        #expect(!WhatsNewGate.isNewer("1.0", than: "1.0.0")); #expect(!WhatsNewGate.isNewer("0.9", than: "1.0"))
    }
}

@Suite struct WhatsNewQuiet {
    let app = "/path/ColdGas"
    @Test func testsAndToolsKeepItAway() {
        // A quiet launch touches nothing: no modal, no record (an update still shows on the next ordinary launch).
        #expect(WhatsNewGate.decide(current: "1.0.1", seen: "1.0.0", quiet: true, hasNotes: true) == .init(show: false, record: nil))
        for flags in [["-uitest"], ["-course", "show", "-tier", "assist"], ["-bench"], ["-selftest"], ["-replay", "show"],
                      ["-cam-log", "-timescale", "1", "-script", "x"], ["-window", "951x669", "-pose", "book"], ["-haptics", "demo"],
                      ["-autopilot"], ["-play"], ["-thumbbot"]] {
            #expect(WhatsNewGate.isQuiet(arguments: [app] + flags, environment: [:]), "\(flags)")
        }
        #expect(WhatsNewGate.isQuiet(arguments: [app], environment: ["XCTestConfigurationFilePath": "/x"]))
    }
    @Test func anOrdinaryLaunchIsNotQuiet() {
        #expect(!WhatsNewGate.isQuiet(arguments: [app], environment: [:]))
        #expect(!WhatsNewGate.isQuiet(arguments: [app, "-NSDocumentRevisionsDebugMode", "YES", "-AppleLanguages", "(en)"], environment: [:]))
        #expect(!WhatsNewGate.isQuiet(arguments: [app, "-com.apple.CoreData.SQLDebug", "1"], environment: [:]))
        #expect(!WhatsNewGate.isQuiet(arguments: [app, WhatsNewGate.forceFlag], environment: [:]))
    }
}

@Suite struct WhatsNewNotes {
    static let ios = URL(fileURLWithPath: #filePath)   // …/ios/Packages/ColdGasCore/Tests/ColdGasClientTests/WhatsNewTests.swift
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static func marketingVersion() throws -> String {
        let yml = try String(contentsOf: ios.appendingPathComponent("project.yml"), encoding: .utf8)
        let r = try #require(yml.range(of: #"MARKETING_VERSION:\s*"[^"]+""#, options: .regularExpression))
        return String(yml[r]).components(separatedBy: "\"")[1]
    }

    @Test func theCurrentVersionHasNotesInTheModalsShape() throws {
        let v = try Self.marketingVersion()
        let md = try String(contentsOf: Self.ios.appendingPathComponent("release-notes/\(v).md"), encoding: .utf8)
        let n = try #require(ReleaseNotes.parse(md), "release-notes/\(v).md needs a headline and 2–4 Highlights (release-notes/README.md)")
        #expect(n.title.contains(v))
        #expect(!n.headline.isEmpty && n.headline.count <= 60)
        #expect((2...4).contains(n.callouts.count))
        for c in n.callouts {
            #expect(c.icon != ReleaseNotes.defaultIcon || md.contains("icon: sparkles"), "\(c.title): name an icon")
            #expect(c.title.split(separator: " ").count <= 5, "\(c.title): a few words")
            #expect(c.line.count <= 90, "\(c.title): one short line")
        }
        #expect(!n.sections.isEmpty, "the full notes")
        #expect(!n.sections.contains { $0.title.lowercased() == "highlights" })
    }

    @Test func theParserReadsTheShape() throws {
        let md = """
        # Cold Gas 9.9.9

        A **headline** here

        A lede
        over two lines.

        ## Highlights
        - **First thing.** Does a thing. <!-- icon: video -->
        - **Second.** Does `another`.
        - not a callout

        ## What is in this build
        - **Bold.** Item one.
        A paragraph.
        """
        let n = try #require(ReleaseNotes.parse(md))
        #expect(n.title == "Cold Gas 9.9.9")
        #expect(n.headline == "A headline here")
        #expect(n.lede == "A lede over two lines.")
        #expect(n.callouts == [.init(icon: "video", title: "First thing", line: "Does a thing."),
                               .init(icon: "sparkles", title: "Second", line: "Does another.")])
        #expect(n.sections == [.init(title: "What is in this build", lines: ["• Bold. Item one.", "A paragraph."])])
    }

    @Test func notesWithoutCalloutsDontShow() {
        #expect(ReleaseNotes.parse("# Cold Gas 1\n\nHeadline\n\n## Highlights\n- **One.** Only one.\n") == nil)
        #expect(ReleaseNotes.parse("# Cold Gas 1\n\n## Highlights\n- **One.** a\n- **Two.** b\n") == nil)
    }
}
