// The judges' words (0219, 0236; operator's call 2026-11-13, Option B). The crew's authored lines (ColdGasClient's
// Crew.swift) are the panel and are on screen at once. Where the device has Apple's on-device model and the player hasn't
// turned it off, the words are written there (OnDeviceJudge.swift: no network, no key, $0) and replace the crew's as they
// arrive; on any failure the crew's lines stand. There is no automatic cloud call: nothing here touches the network.
//
//   for await e in client.judges(card: …, authored: …, route: …, onDevice: …) { … }
//
// The stream always ends with exactly one `.finished(words:meta:)`: the model's words, or the crew's lines with the receipt
// saying so (invariant 5½: authored lines are never passed off as a model's). Stop reading (or cancel the task) and the call
// is cancelled, and no `.finished` comes.
import Foundation
import ColdGasClient

final class JudgesClient: @unchecked Sendable {
    func judges(card: ScoreCard, authored: JudgeWords, route: JudgeRoute = .authored, onDevice: OnDeviceJudgeModel? = nil,
                place: String = "this device") -> AsyncStream<JudgeEvent> {
        AsyncStream { out in
            let task = Task {
                let said = await judgePanel(card: card, route: route, model: onDevice, place: place, authored: authored, emit: { _ = out.yield($0) })
                if let said, !Task.isCancelled { out.yield(.finished(words: said.0, meta: said.1)) }
                out.finish()
            }
            out.onTermination = { _ in task.cancel() }
        }
    }
}
