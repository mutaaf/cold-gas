// src/panel.js's network half: the board. The app posts the run's input log and telemetry, never a score: the Worker scores
// the telemetry itself after its plausibility checks (src/worker/index.js boardCheck). The pure half (rows, messages,
// response models, the bodies) is ColdGasClient. docs/NATIVE.md §7.
import Foundation
import ColdGasClient

struct ColdGasAPI {
    static let production = ColdGasAPI(base: URL(string: "https://mutaafaziz.com/coldgas/api")!)
    let base: URL
    var session: URLSession = Net.session

    // The server scores from telemetry in a few ms, but a 503 is retried twice: give it room, never leave "Posting…" up forever.
    static let POST_MS = 15_000.0, BOARD_MS = 8000.0, DRY_MS = 6000.0
    enum Board: String { case today, all }

    private var scores: URL { base.appendingPathComponent("scores") }
    private func decode(_ data: Data) -> ScoresResponse { (try? JSONDecoder().decode(ScoresResponse.self, from: data)) ?? ScoresResponse() }

    /// postScore: a REAL board entry (public, and it can't be taken back). Retried on a 503, inside one deadline.
    /// On no answer: `status` 0, `timeout` true if the deadline ran out.
    func postScore(log: [[Int]], t: JSValue, initials: String, course: String) async -> PostResult {
        let sp = Signs.poster.beginInterval("board-post", id: Signs.poster.makeSignpostID()); defer { Signs.poster.endInterval("board-post", sp) }   // 0300
        let body = RequestBody.post(log: log, t: t, initials: cleanInitials(initials), course: course).jsonData
        let req = Net.jsonPost(scores, body: body, timeout: ColdGasAPI.POST_MS / 1000)
        let s = session
        do {
            let (data, res) = try await Net.withDeadline(ms: ColdGasAPI.POST_MS) {
                try await Net.postRetry { try await Net.fetch(req, ms: ColdGasAPI.POST_MS, session: s) }
            }
            // 0293: a refused post is the player's message (postMessage); a 5xx after the retries is ours to see.
            if res.statusCode >= 500 { Report.error(.net, .fetch, "post answered \(ColdGasAPI.statusClass(res.statusCode))") }
            return PostResult(ok: (200..<300).contains(res.statusCode), status: res.statusCode, response: decode(data))
        } catch NetError.timeout {
            Report.error(.net, .fetch, "post timeout")
            return PostResult(ok: false, status: 0, timeout: true)
        } catch {
            if let w = ColdGasAPI.why(error) { Report.error(.net, .fetch, "post \(w)") }
            return PostResult(ok: false, status: 0)
        }
    }

    /// The whole answer to `dry: true`: every check of a real post, the card and the rank it would get, and nothing stored.
    /// One try, a short deadline, no retry.
    func dryPost(log: [[Int]], t: JSValue, course: String, ms: Double = ColdGasAPI.DRY_MS) async -> PostResult {
        let body = RequestBody.dry(log: log, t: t, course: course).jsonData
        do {
            let (data, res) = try await Net.fetch(Net.jsonPost(scores, body: body, timeout: ms / 1000 + 1), ms: ms, session: session)
            return PostResult(ok: (200..<300).contains(res.statusCode), status: res.statusCode, response: decode(data))
        } catch NetError.timeout {
            return PostResult(ok: false, status: 0, timeout: true)
        } catch {
            return PostResult(ok: false, status: 0)
        }
    }
    /// dryRank: the rank this run would get on today's board for its course, asked before posting. A slow or failed
    /// answer is nil, and the button stays plain "Post" (rankLabel gives its words).
    func dryRank(log: [[Int]], t: JSValue, course: String, ms: Double = ColdGasAPI.DRY_MS) async -> Int? {
        let r = await dryPost(log: log, t: t, course: course, ms: ms)
        return r.ok && r.response.dry == true ? r.rank : nil
    }

    /// fetchBoard: the board's rows, top 20 (nil: offline). `course` nil: every course. Cancel by cancelling the Task.
    func fetchBoard(_ board: Board = .today, course: String? = nil) async -> [BoardRow]? {
        let sp = Signs.poster.beginInterval("board-fetch", id: Signs.poster.makeSignpostID()); defer { Signs.poster.endInterval("board-fetch", sp) }   // 0300
        guard var c = URLComponents(url: scores, resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = [URLQueryItem(name: "board", value: board.rawValue)]
        if let course, COURSE_IDS.contains(course) { c.queryItems?.append(URLQueryItem(name: "course", value: course)) }
        guard let url = c.url else { return nil }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: ColdGasAPI.BOARD_MS / 1000)
        // 0293: retried with backoff (a GET is safe to ask again), and a board that still doesn't answer is reported.
        let out: (Data, HTTPURLResponse)
        do { out = try await Net.getRetry(req, ms: ColdGasAPI.BOARD_MS, session: session) } catch {
            // No network is the player's state, not a fault: the sheet says so and nothing is reported.
            if !Task.isCancelled, let w = ColdGasAPI.why(error) { Report.error(.net, .fetch, "board \(w)") }
            return nil
        }
        guard (200..<300).contains(out.1.statusCode) else { Report.error(.net, .fetch, "board answered \(ColdGasAPI.statusClass(out.1.statusCode))"); return nil }
        guard let rows = (try? JSONDecoder().decode(BoardResponse.self, from: out.0))?.boardRows else {
            Report.error(.net, .fetch, "board answer didn't decode"); return nil
        }
        return rows
    }

    /// A status in words that survive the signature's number folding: "5xx", "429", "4xx".
    static func statusClass(_ s: Int) -> String { s == 429 ? "slow-down" : s == 503 ? "unavailable" : s >= 500 ? "5xx" : s >= 400 ? "4xx" : "other" }
    /// A transport failure in words that group (no URL, no host); nil for no network at all (not a fault).
    static func why(_ e: Error) -> String? {
        if let n = e as? NetError { return n == .timeout ? "timeout" : "answer not HTTP" }
        let ns = e as NSError
        guard ns.domain == NSURLErrorDomain else { return "error \(ns.domain)" }
        switch ns.code {
        case NSURLErrorNotConnectedToInternet, NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff: return nil
        case NSURLErrorTimedOut: return "timeout"
        case NSURLErrorNetworkConnectionLost: return "connection lost"
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return "host not found"
        case NSURLErrorCannotConnectToHost: return "cannot connect"
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate: return "tls failed"
        case NSURLErrorCancelled: return nil
        default: return "url error"
        }
    }
}
