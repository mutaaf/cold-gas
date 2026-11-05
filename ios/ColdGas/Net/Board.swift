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
        let body = RequestBody.post(log: log, t: t, initials: cleanInitials(initials), course: course).jsonData
        let req = Net.jsonPost(scores, body: body, timeout: ColdGasAPI.POST_MS / 1000)
        let s = session
        do {
            let (data, res) = try await Net.withDeadline(ms: ColdGasAPI.POST_MS) {
                try await Net.postRetry { try await Net.fetch(req, ms: ColdGasAPI.POST_MS, session: s) }
            }
            return PostResult(ok: (200..<300).contains(res.statusCode), status: res.statusCode, response: decode(data))
        } catch NetError.timeout {
            return PostResult(ok: false, status: 0, timeout: true)
        } catch {
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
        guard var c = URLComponents(url: scores, resolvingAgainstBaseURL: false) else { return nil }
        c.queryItems = [URLQueryItem(name: "board", value: board.rawValue)]
        if let course, COURSE_IDS.contains(course) { c.queryItems?.append(URLQueryItem(name: "course", value: course)) }
        guard let url = c.url else { return nil }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: ColdGasAPI.BOARD_MS / 1000)
        guard let (data, res) = try? await Net.fetch(req, ms: ColdGasAPI.BOARD_MS, session: session), (200..<300).contains(res.statusCode) else { return nil }
        return (try? JSONDecoder().decode(BoardResponse.self, from: data))?.boardRows
    }
}
