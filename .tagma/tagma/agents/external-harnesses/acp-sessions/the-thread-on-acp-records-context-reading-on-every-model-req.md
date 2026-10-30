---
id: 01a1160e-5fdd-73bc-b2e5-353cc7d3d8a2
title: "The thread on ACP records context reading on every model request: `usage_update` with `_meta['tagma/measured']` carries the request usage, the send lower bound, and the recorded cache lifetime"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/measure.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/meter.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/harness/turns.ts
    symbol: readingOf
---
The native cycle records context reading after every model request, and the thread on ACP does the same. Otherwise context would stand still for the whole turn, and "Next request" would stay `unknown`: the `claude-code` provider in the catalog promises nothing about cache lifetime, and there are no Claude Code requests in the Tagma request journal, so there is nothing to build a local curve from.

- **Source.** The agent sends `usage_update` on every model request, and when the window is still unknown — then `size: 0`, and the request is recorded without window reading. The driver step containing it is always saved, even if the client machine counts it as live. Every `usage_update` with `tagma/measured` lands as a kernel `measured` report on the same record: the kernel assigns `stepNumber` itself (the run's `step-finished` count), records `step-finished` with usage and reading, and lands the request (`RunRequests.land`: run usage grows at once, the opening `composition` is estimated on the first request). A repeat of the same vendor message (`message.id`) is a no-op. The turn end no longer rewrites the reading. Without a request, only compaction records the reading (`recorded`): `postTokens` or stale.
- **What is measured.** The Tagma extension `_meta['tagma/measured']` on `usage_update` describes the request in Tagma terms. `input` — the whole input including cache, beside it cache reading and writing, `output`, `reasoning`, `sentAt` and `ttlSeconds`. The driver translates this into the reading's `Usage`. An agent without this `_meta` (Devin) yields reading only from `used`/`size`, with no cache lifetime. An unreadable `_meta` goes to link noise, but the window measurement is still recorded.
- **`sentAt` is the lower bound.** The runner cannot see when Claude Code sent the request. So it takes the last moment the model was given input: the prompt echo, the tool result, the previous request end. Warmth counts from `min(sentAt, measuredAt)`, so the bound gives a cautious forecast, not an optimistic one.
- **`ttlSeconds` is the recorded cache lifetime.** The runner reads it from `cache_creation` in the request's `message_start`. If a 5-minute cache was recorded — 300 s, else if an hourly one — 3600 s. If the request recorded no cache, the previous record of this session keeps its lifetime. Until the session has recorded anything, the lifetime is unknown. From here comes the session warm-copy lifetime for recap and the header ([[f3949b43|aside via session]]): for Claude Code it depends on the account (1 hour for subscribers), so a hard-wired value would be wrong.
- **Window.** `size` is the current model's window per `getContextUsage({ detail: 'summary' })`. The runner's `Settings` reads it at session open and after a model change, so the window is known already on the first request. SDK `assistant` messages are unfit for measurement: they carry output from `message_start`, while the final output and `thinking_tokens` arrive in `message_delta`.

Measurement of 2026-10-07 (claude 2.1.292, SDK 0.3.292, haiku, one run). `getContextUsage` answers with a 200,000 window matching `modelUsage.contextWindow` even before the first request, then in 2–5 ms. The prompt echo arrives 1 ms before `message_start`. In a subscriber's session transcript, Claude Code records `ephemeral_1h_input_tokens`.
