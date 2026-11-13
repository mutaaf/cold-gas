// A link that opens the app (0253): the web's challenge links, as universal links (https://mutaafaziz.com/coldgas/…#vs=…)
// or the fallback scheme (coldgas://…, the same query and fragment), routed to what the app shows. Pure: the URL in, the
// route out. The payload is the web's (Challenge.decode, bit-exact, pinned by Vectors/challenge.json); nothing new.
import Foundation

public enum ChallengeLink {
    public enum Route: Equatable {
        /// A challenge to take: the sender's run (course, tier, score, initials, log).
        case challenge(Challenge.Run)
        /// A challenge from another SIM_VERSION: say so, offer a plain Fly on its course.
        case stale(course: String)
        /// A link with a payload that can't be read: a plain Fly on the course the link names, if it names one.
        case bad(course: String?)
        /// A plain game link (`?play=jump&course=…`): the title, on that course.
        case play(course: String?)
        /// Not ours.
        case none
    }

    public static func isOurs(_ url: URL) -> Bool {
        if url.scheme?.lowercased() == "coldgas" { return true }
        guard url.scheme?.lowercased() == "https", let h = url.host?.lowercased(), h == "mutaafaziz.com" || h == "www.mutaafaziz.com" else { return false }
        return url.path == "/coldgas" || url.path.hasPrefix("/coldgas/")
    }

    public static func route(_ url: URL, simVersion: Int) -> Route {
        guard isOurs(url) else { return .none }
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let course = c?.queryItems?.first { $0.name == "course" }?.value.flatMap { Challenge.COURSE_IDS.contains($0) ? $0 : nil }
        let hash = url.fragment.map { "#" + $0 } ?? ""
        guard !hash.isEmpty, hash.contains("vs=") else { return .play(course: course) }
        guard let p = Challenge.vsFromHash(hash), let run = Challenge.decode(p, simVersion: simVersion) else { return .bad(course: course) }
        if run.stale { return .stale(course: run.course) }
        return .challenge(run)
    }
}
