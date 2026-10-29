---
id: 01a12f88-66ed-7306-9d96-db5a9ea5cde8
title: A thread's live feed survives a frame that fails the socket's JSON codec, and does not lie with "Reconnecting"
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12f52-cc56-7a59-ac20-b35b2482680c",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/ToolArguments.ts
  - kind: file
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
  - kind: file
    ref: packages/utils/src/json.ts
---
The thread's live feed survives a frame that fails the socket's JSON codec, and does not lie with "Reconnecting".

Chain reproduced on the live server 2026-10-12: an arguments refusal (`body-shape`, extra argument) builds a `ToolArgumentsInvalid.output` with `undefined` keys. The `invalidCall` path bypasses the door's converter, and the open `put` frame with that output is not encodable by Effect's JSON codec: `undefined` is not JSON. `RpcServer` silently ends one `thread.subscribe` subscription through a defect. `ThreadPort` turns it into `ChatFeedRefused`, after which `ThreadSession` reading ends forever, and `runVerdict` yields phase `unknown`, i.e. "Reconnecting".

What to do:
- One strict value-to-JSON converter in `@runlith/utils/json` instead of two diverging ones (`toJson`, `toStructuredValue`).
- Tool output typed as JSON on every door road and `ToolOutcome`: the compiler demands the converter.
- The chat port tells a broken subscription from a refusal. `ThreadSession` re-reads a broken one with backoff, and the run-line signature stays truthful.
- The server socket door logs a defect-ended subscription.
- Contract regression tests.

Done when tests pass and a rerun repeats the extra-argument call while the open thread's feed moves on.
