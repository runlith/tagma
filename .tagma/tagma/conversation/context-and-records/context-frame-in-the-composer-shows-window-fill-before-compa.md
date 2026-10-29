---
id: 01a14bc0-761f-7208-a969-908ea267ca10
title: Context frame in the composer shows window fill before compaction and prompt-cache warmth, and on hover — what the request consists of
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9285e59adbe3
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: relates
    to: 01a14bc0-7656-71a8-87f1-676f905b4121
  - kind: relates
    to: 01a14bc0-7660-7057-8507-468f3ccccf91
  - kind: relates
    to: 01a14bc0-766c-7277-8b8e-47f50363c0ef
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/context.composer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Panel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/TranscriptFacts.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/warmthWords.ts
  - kind: file
    ref: packages/agent/src/thread/composition/requestComposition.ts
  - kind: file
    ref: packages/chat-ui/src/ChatContextUsagePill.svelte
  - kind: file
    ref: packages/chat-ui/src/contextUsage.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/snapshot.ts
    symbol: threadCompositionReadingSchema
---
**Value.** The operator sees how much window is left before compaction, how warm the prompt cache is, and what exactly eats context and money — and decides whether to compact, clean, or start a new thread.

**How.** A square frame in the composer, left of the microphone and the run button — the same one stands in the thread row and peek; the share fills its perimeter clockwise from the middle of the top side. The percentage always stands beside it when known; from 80% the frame and digit turn red. Hover opens the composition panel, behind it the `read_thread_composition` operation. Under the run's last answer — the request size.

**Behaviour.**
- The percentage counts against the auto-compaction point when set, otherwise against the model window; the tile in the frame's centre is the warm cache.
- The panel opens with the share large and "361.2K of 850K"; caveats of that figure (estimate, stale measurement, next-request size) stand right under it. Below — where the thread will compact and whose setting it is, as a one-line link to the setting; it stays visible both while the composition reads and when the read refused.
- One scale from zero to the compaction point (or to the window) is filled to the same share printed on top, and the filled part is split by their size in the last read composition into system prompt, tool schemas, orientation, and conversation, in text-tone colors — color in the window is a signal, while request parts signal nothing. Below, the same parts as rows with tokens; tools open by source with deferred ones apart, conversation by content kind. An estimated composition is marked "~" with a pale scale. A fresh measurement arriving with the panel open re-reads the composition.
- The Cache row is one line: whether the cache is warm (a filled or empty tile, as in the frame's centre) — "warm, 49 min left", "cold for 3 h", "cold, compacted", "74% chance warm" — and the last request's hit share.
- Under Details — the last request's digits and the tool-output cleanup as "number over word" cells in a shared grid, and the thread's history; collapsed thread folds stay remembered.
- No row widens the panel: long text fades, and a panel too tall scrolls inside itself.

**Limits.** Without a measurement the frame shows the last known size with a question mark.
