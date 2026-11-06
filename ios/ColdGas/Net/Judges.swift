// The judges' call (src/ai/stream.js, and the deadline and breaker of src/main.js + src/ai/theatre.js). POST /judge/stream
// needs no key on the free edge model: it scores the run's telemetry itself, then streams the panel's words.
//
//   for await e in client.judges(run: …, log: …, t: …, card: …) { … }
//
// The stream always ends with exactly one `.finished(words:meta:)` within JUDGE_MS: the model's words, or the local lines
// with the reason on the receipt (invariant 5½: the panel never blocks the results, and local lines are never passed off
// as the AI's). Stop reading (or cancel the task) and the call is cancelled, and no `.finished` comes.
import Foundation
import ColdGasClient

/// What the call needs from the run. `assist`: flown on Assist or the autopilot (the Worker takes the tier from the log).
struct JudgedRun {
    var course: String
    var assist: Bool
}

final class JudgesClient: @unchecked Sendable {
    let api: ColdGasAPI
    let save: SaveStore
    var now: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    init(api: ColdGasAPI = .production, save: SaveStore = .shared) { self.api = api; self.save = save }

    func judges(run: JudgedRun, log: [[Int]], t: JSValue, card: ScoreCard, ai: JudgeAI = .edge) -> AsyncStream<JudgeEvent> {
        AsyncStream { out in
            let task = Task { [self] in
                await call(run: run, log: log, t: t, card: card, ai: ai, deadlineMs: JUDGE_MS, out: out)
                out.finish()
            }
            out.onTermination = { _ in task.cancel() }
        }
    }

    /// What the call has learnt so far, shared with the deadline's side of the race. `emit` is the one way out: once the
    /// call is closed a late event from a stream still being cancelled is dropped, so `.finished` really is last.
    private final class Call: @unchecked Sendable {
        private let lock = NSLock()
        private let out: AsyncStream<JudgeEvent>.Continuation
        private var closed = false, _done: JudgeDone?, _failure: String?, _verify: JudgeVerify?, _prompt: JudgePrompt?
        init(_ out: AsyncStream<JudgeEvent>.Continuation) { self.out = out }
        func emit(_ e: JudgeEvent) {
            lock.lock(); defer { lock.unlock() }
            if closed { return }
            switch e {
            case let .verify(v): _verify = v
            case let .prompt(p): _prompt = p
            case let .done(d): _done = d
            case let .error(f): _failure = f.message
            default: break
            }
            out.yield(e)
        }
        func close() -> (done: JudgeDone?, failure: String?, verify: JudgeVerify?, prompt: JudgePrompt?) {
            lock.lock(); defer { lock.unlock() }
            closed = true
            return (_done, _failure, _verify, _prompt)
        }
    }
    /// The race's result: the first to arrive wins (true: the deadline), whichever task is still unwinding. A result
    /// that arrives before anyone waits is kept for them.
    private final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var waiter: CheckedContinuation<Bool, Never>?, result: Bool?
        func wait(_ c: CheckedContinuation<Bool, Never>) {
            lock.lock()
            if let r = result { lock.unlock(); c.resume(returning: r) } else { waiter = c; lock.unlock() }
        }
        func fire(_ v: Bool) {
            lock.lock()
            guard result == nil else { lock.unlock(); return }
            result = v
            let w = waiter; waiter = nil
            lock.unlock()
            w?.resume(returning: v)
        }
    }

    func call(run: JudgedRun, log: [[Int]], t: JSValue, card: ScoreCard, ai: JudgeAI, deadlineMs: Double, out: AsyncStream<JudgeEvent>.Continuation) async {
        // [the breaker] After repeated overruns the panel speaks local lines for a while, then tries again.
        var breaker = Breaker(save.data.judgeBreaker ?? BreakerState())
        let allowed = breaker.allow(now: now())
        save.update { $0.judgeBreaker = breaker.s }
        guard allowed else {
            out.yield(.finished(words: localWords(card), meta: .localMeta(.breaker)))
            return
        }
        let state = Call(out)
        let api = self.api
        let body = RequestBody.judges(log: log, t: t, assist: run.assist, course: run.course, ai: ai).jsonData
        // Not a task group: a group waits for the loser to unwind, and the words land on time whatever the network is doing.
        let once = Once()
        let stream = Task { await JudgesClient.stream(api: api, body: body, ai: ai, state: state); once.fire(false) }
        let timer = Task {
            try? await Net.sleep(ms: deadlineMs)
            if !Task.isCancelled { once.fire(true) }
        }
        let timedOut = await withTaskCancellationHandler {
            await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in once.wait(c) }
        } onCancel: { once.fire(false) }
        stream.cancel(); timer.cancel()
        let got = state.close()
        if Task.isCancelled { return }   // the player moved on: nothing to say
        var meta = JudgeMeta(ok: got.done != nil, error: got.failure, provider: got.prompt?.provider ?? ai.provider, model: got.done?.model ?? got.prompt?.model ?? ai.model,
                             where: got.prompt?.where, done: got.done, verify: got.verify)
        let words: JudgeWords
        if let done = got.done {
            words = done.words
            meta.error = nil
            update { $0.success(now: self.now()) }
        } else {
            words = localWords(card)
            if timedOut && meta.error == nil { meta.error = "The judges took too long." }
            if meta.error == nil { meta.error = "No answer." }
            // Only a deadline the provider had most of counts against the breaker (0057).
            if judgesOverran(meta.error, providerMs: deadlineMs) { let e = meta.error ?? ""; update { $0.failure(e, now: self.now()) } }
        }
        out.yield(.finished(words: words, meta: meta))
    }

    private func update(_ f: (inout Breaker) -> Void) {
        save.update { d in
            var b = Breaker(d.judgeBreaker ?? BreakerState())
            f(&b)
            d.judgeBreaker = b.s
        }
    }

    /// streamPanel: the request (retried on a 503), then the events as they arrive.
    private static func stream(api: ColdGasAPI, body: Data, ai: JudgeAI, state: Call) async {
        func fail(_ message: String, offline: Bool?) { state.emit(.error(JudgeFailure(message: message, fallback: true, offline: offline))) }
        var headers: [String: String] = [:]
        if ai.provider != "edge", let key = ai.key, !key.isEmpty { headers["x-cg-key"] = key }   // for this one call; never logged
        let req = Net.jsonPost(api.base.appendingPathComponent("judge/stream"), body: body, timeout: JUDGE_MS / 1000 + 5, headers: headers)
        let session = api.session
        do {
            let (bytes, res): (URLSession.AsyncBytes, HTTPURLResponse) = try await Net.postRetry {
                let (b, r) = try await session.bytes(for: req)
                guard let h = r as? HTTPURLResponse else { throw NetError.notHTTP }
                return (b, h)
            }
            guard (200..<300).contains(res.statusCode) else {
                fail(res.statusCode == 400 && ai.provider != "edge" ? "That key looks malformed." : "The judges are offline.", offline: res.statusCode >= 404)
                return
            }
            var parser = SSEParser(), text = "", chunk: [UInt8] = []
            chunk.reserveCapacity(512)
            func flush() {
                for m in parser.feed(chunk) {
                    if let e = judgeEvent(m, text: &text) { state.emit(e) }
                }
                chunk.removeAll(keepingCapacity: true)
            }
            // A token must show as it lands: hand over at each newline (each SSE line ends in one), not at a buffer's end.
            for try await b in bytes {
                chunk.append(b)
                if b == 10 { flush() }
            }
            flush()
        } catch {
            if Task.isCancelled { return }   // the deadline or the caller: not the network's failure
            fail("The judges are offline.", offline: true)
        }
    }
}
