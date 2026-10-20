# Changelog

## 0.2.1 — 2026-10-19

Bring your own key, made caveman-simple:
- **One paste box:** the provider is detected from the key itself (Anthropic `sk-ant-`, OpenAI `sk-`, xAI `xai-`, Google `AIza`).
- **No setup:** the key is checked against the provider's live model list, the cheapest fast model is picked, and it's saved. No buttons.
- **Forgiving pastes:** quotes, `Bearer `, `NAME=` prefixes and stray whitespace are cleaned up.
- **Look-alike keys explained:** Groq vs Grok, OpenRouter, GitHub tokens and others get a friendly explanation and are never sent.
- **Help getting a key:** a Paste-from-clipboard button and one-tap "get a key" tiles with the exact steps.
- **Easy switching:** Advanced has a model picker, and one tap goes back to the free judges.

## Unreleased

2026-10-20 · #0001 · Ghost of your best run: your best jump (or the reference, until you land one) rides alongside the next attempt as a translucent silhouette; toggle it with G or the ghost button.

## 0.2.0 — 2026-10-19

The judges' brain and theatre:
- **Free default:** an open model (Gemma 4 26B-A4B) on Cloudflare Workers AI. It costs about $0.0001 a judging, with Llama 3.1 8B as the fallback.
- **Bring your own key:** for Anthropic, OpenAI, xAI (Grok) or Google (Gemini). Connecting lists the provider's live models and suggests the cheapest current fast one.
- **Streaming:** judgings stream over SSE.
- **The theatre:** shows each call as an aurora-field particle sequence: circuit → text → compute → app. It has live tokens, latency, neurons and cost, plus a receipt with the call to replay and inspect.

## 0.1.0 — 2026-10-19

First playable: deterministic 6-DOF sim with ten cold-gas nozzles, Assist/Pro flight computer, reference jump autopilot, six-category three-judge scoring, AI panel commentary via the Worker (server-verified by replay), D1 daily board, blue-hour range with procedural vehicles, keyboard/gamepad/touch, deep links `?play=jump|reveal`, `?board=today|all`, `?gfx=`.
