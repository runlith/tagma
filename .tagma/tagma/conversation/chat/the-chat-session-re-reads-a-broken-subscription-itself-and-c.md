---
id: 01a12f9e-8106-7371-95b7-ec9e651a2eb8
title: The chat session re-reads a broken subscription itself, and closes a refused one with no live-run row
ord: 43
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12f88-66ed-7306-9d96-db5a9ea5cde8
sources:
  - kind: file
    ref: packages/chat-ui/src/session/feedRetry.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/ThreadPort.ts
    symbol: ThreadPort
  - kind: symbol
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
    symbol: ThreadSession
---
The chat port tells two subscription ends apart. `ChatFeedRefused` is a coded server refusal (`thread-gone`, `not-found`, `foreign-project`): the session stops reading the feed, the reason stands in the "This thread could not be read" chip, and there is no live-run row (`runVerdict` on `closed` answers `null`). `ChatFeedBroken` is a subscription that ended in a defect or codeless error, e.g. a frame the server could not encode. The socket stays alive, and there will be no reconnect, so the session re-reads the subscription itself.

`ThreadSession` re-reads a broken subscription and exhausted skips (`FeedGap`) under `feedRecoveryPolicy`: backoff from 250 ms with a 30 s ceiling, no attempt limit, reset on the first frame read. A broken one reads from the held position (`resume`). Skips read from a fresh snapshot (empty `since`): the position where the feed diverges from the server would give the same skip.

While re-reading runs, the feed is non-live of kind `broken` (`FeedReading` in `FeedVerdicts`): the run row writes "Thread is not showing: <reason>" with "Copy details" and the last frame's moment, not "Reconnecting". "Reconnecting" is only kind `lost`: an `interrupted` frame from the port, when the server link dropped and the socket raises the subscription itself. Reads used to end on any refusal, and the label hung until page reload. No attempt limit is deliberate: a deterministic failure costs one resubscribe per 30 s and passes on its own once the server is fixed.
