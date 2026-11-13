// Apple's on-device model as the judges' brain (0219): FoundationModels' SystemLanguageModel, iOS 26 and later with Apple
// Intelligence. The app still runs on iOS 18, so all of it sits behind canImport + @available, and everywhere else
// `OnDeviceJudges.status` says why not and the call goes to the edge model as before. Nothing here leaves the device.
//
// Guided generation fills `PanelWords`, the same four parts the cloud panel writes (headline, engineer, coordinator,
// designer), from the same brief (ColdGasClient's ON_DEVICE_INSTRUCTIONS + judgePrompt: the voices and the run's numbers
// only). The parts are streamed in order, so the words land as they're written. The route, the deadline, the fallback and
// the receipt are ColdGasClient's (OnDeviceJudge.swift), tested there with a fake model.
import Foundation
import UIKit
import ColdGasClient
#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDeviceJudges {
    /// Can this device judge on-device right now? Cheap: read again for every call and every look at Settings.
    static var status: OnDeviceStatus {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return .available
            case .unavailable(.deviceNotEligible): return .deviceNotEligible
            case .unavailable(.appleIntelligenceNotEnabled): return .notEnabled
            case .unavailable(.modelNotReady): return .notReady
            case .unavailable: return .unknown
            }
        }
        #endif
        return .osTooOld
    }

    /// The model, when it can judge (nil before iOS 26, or in a build without the framework).
    static func model() -> OnDeviceJudgeModel? {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) { return AppleOnDeviceModel() }
        #endif
        return nil
    }

    /// Where it ran, for the receipt: "this iPhone", "this iPad".
    /// Words only, never a branch on the device (check-rules 5): the idiom says which to name.
    @MainActor static var place: String { UIDevice.current.userInterfaceIdiom == .pad ? "this iPad" : "this iPhone" }
}

#if canImport(FoundationModels)
/// What the panel writes, as a schema: guided generation can only produce these four parts, in this order.
@available(iOS 26.0, *)
@Generable(description: "The judging panel's words on one run")
struct PanelWords {
    @Guide(description: "A headline for the run, at most 6 words")
    var headline: String
    @Guide(description: "The Chief Vehicle Engineer's remark: dry and exacting, at most 22 words, about something specific in the facts")
    var engineer: String
    @Guide(description: "The Stunt Coordinator's remark: warm and theatrical, at most 22 words, about something specific in the facts")
    var coordinator: String
    @Guide(description: "The Head of Design's remark: minimal and precise, at most 22 words, about something specific in the facts")
    var designer: String
}

@available(iOS 26.0, *)
struct AppleOnDeviceModel: OnDeviceJudgeModel {
    func judge(instructions: String, prompt: String) -> AsyncThrowingStream<OnDeviceSnapshot, Error> {
        AsyncThrowingStream { out in
            let task = Task {
                do {
                    // A fresh session per run: the judges see this run's numbers and nothing from the last one.
                    let session = LanguageModelSession(model: .default, instructions: instructions)
                    let stream = session.streamResponse(to: prompt, generating: PanelWords.self, options: GenerationOptions(temperature: 0.8))
                    for try await snap in stream {
                        let p = snap.content
                        var usage: OnDeviceUsage?
                        if #available(iOS 27.0, *) {
                            let u = snap.usage
                            if u.input.totalTokenCount > 0 || u.output.totalTokenCount > 0 {
                                usage = OnDeviceUsage(inTokens: Double(u.input.totalTokenCount), outTokens: Double(u.output.totalTokenCount), source: .reported)
                            }
                        }
                        out.yield(OnDeviceSnapshot(words: JudgeWords(headline: p.headline ?? "", engineer: p.engineer ?? "", coordinator: p.coordinator ?? "",
                                                                     designer: p.designer ?? "", source: "ai"), usage: usage))
                    }
                    out.finish()
                } catch {
                    out.finish(throwing: OnDeviceJudgeError(AppleOnDeviceModel.reason(error)))
                }
            }
            out.onTermination = { _ in task.cancel() }
        }
    }

    /// The model's own failures in a player's words, for the receipt. Each one falls back to the edge model.
    static func reason(_ error: Error) -> String {
        if error is CancellationError { return "cancelled" }
        if #available(iOS 27.0, *) {
            if let e = error as? LanguageModelError {
                switch e {
                case .guardrailViolation: return "its safety guardrail stopped it"
                case .refusal: return "it declined"
                case .contextSizeExceeded: return "the brief was too long for it"
                case .unsupportedLanguageOrLocale: return "it doesn\u{2019}t speak this device\u{2019}s language yet"
                case .rateLimited: return "it was busy"
                case .timeout: return "it took too long"
                default: return "it couldn\u{2019}t answer"
                }
            }
            if error is SystemLanguageModel.Error { return "its model isn\u{2019}t ready on this device" }
        }
        if let e = error as? LanguageModelSession.GenerationError {
            switch e {
            case .guardrailViolation: return "its safety guardrail stopped it"
            case .refusal: return "it declined"
            case .exceededContextWindowSize: return "the brief was too long for it"
            case .assetsUnavailable: return "its model isn\u{2019}t ready on this device"
            case .unsupportedLanguageOrLocale: return "it doesn\u{2019}t speak this device\u{2019}s language yet"
            case .rateLimited, .concurrentRequests: return "it was busy"
            case .decodingFailure, .unsupportedGuide: return "it couldn\u{2019}t fill in the panel\u{2019}s card"
            @unknown default: return "it couldn\u{2019}t answer"
            }
        }
        return "it couldn\u{2019}t answer"
    }
}
#endif
