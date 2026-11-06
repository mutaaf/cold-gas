// src/net.js: every network call has a deadline and a cancel, a POST is retried on a 503 (the platform's answer when an
// isolate has run over its CPU budget: the next try usually lands on a fresh isolate). A Swift Task's cancel is the
// web's AbortSignal. docs/NATIVE.md §7.
import Foundation

enum NetError: Error, Equatable {
    /// A deadline ran out (the web's TimeoutError).
    case timeout
    case notHTTP
}

enum Net {
    /// A session with nothing to remember: no cookies, no cache, and it fails at once rather than waiting for a network.
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.waitsForConnectivity = false
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    /// A deadline's clock. A tolerance, because a plain long Task.sleep is coalesced by seconds (measured: a 31 s sleep
    /// woke at 33 s), and "the words land within 35 s" is a promise.
    static func sleep(ms: Double) async throws {
        try await Task.sleep(for: .milliseconds(ms), tolerance: .milliseconds(50), clock: .continuous)
    }

    /// Settles with `op`, or throws `.timeout` after `ms`; the loser is cancelled. (withDeadline)
    static func withDeadline<T>(ms: Double, _ op: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { g in
            g.addTask { try await op() }
            g.addTask {
                try await sleep(ms: ms)
                throw NetError.timeout
            }
            defer { g.cancelAll() }
            guard let v = try await g.next() else { throw NetError.timeout }
            return v
        }
    }

    /// One request: its body and status. Gives up after `ms`. (fetchWithDeadline, here for a whole short JSON answer.)
    static func fetch(_ req: URLRequest, ms: Double, session: URLSession = Net.session) async throws -> (Data, HTTPURLResponse) {
        try await withDeadline(ms: ms) {
            let (d, r) = try await session.data(for: req)
            guard let h = r as? HTTPURLResponse else { throw NetError.notHTTP }
            return (d, h)
        }
    }

    /// POST, tried twice more on a 503 (postRetry's waits). The caller's deadline or cancel ends it.
    static let RETRY_WAITS_MS: [Double] = [1200, 3000]
    static func postRetry<R>(_ request: @escaping () async throws -> (R, HTTPURLResponse), waits: [Double] = RETRY_WAITS_MS) async throws -> (R, HTTPURLResponse) {
        var i = 0
        while true {
            let out = try await request()
            if out.1.statusCode != 503 || i >= waits.count || Task.isCancelled { return out }
            try await sleep(ms: waits[i])
            i += 1
        }
    }

    /// A POST with a JSON body, as the web's fetch makes it (the Worker checks neither Origin nor a token).
    static func jsonPost(_ url: URL, body: Data, timeout: TimeInterval, headers: [String: String] = [:]) -> URLRequest {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        r.httpBody = body
        return r
    }
}
