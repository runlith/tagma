---
id: 01a15e7e-ec1d-7baa-a515-f82c00d5da5d
title: "A notification signal carries its fact as a structured `notice`: the interface draws from it, the model reads the old text"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/detach.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/callEndings.ts
  - kind: file
    ref: packages/chat-ui/src/notices.ts
  - kind: symbol
    ref: packages/agent/src/agent/contracts.ts
    symbol: AgentSignalNotice
---
A notification signal carries its fact as a structured `notice`: the interface draws from it, the model reads the old text.

Server-to-thread messages — about a child (ended the turn, compacted, cooled, changed model or reasoning), about a call ended in background, and about a team left in background (`command-ending`: signature, full command, outcome, exit, tail output) — are written for the model: the text names the wake price, UTC hours, words for the agent. A human needs the same facts differently: a thread link, local time, how long the cache still holds. So the fact travels beside the text as a `notice` field through inbox, journal, and waiting-words wire, while the feed and the waiter box draw only from it and never parse the text. Records without `notice` (before that field) show as raw text in the output well, like any text for the model.

The child lies inside `notice`, not in `senderThreadId`/`from`: a signal with a thread sender becomes the projection feed's agent words, visible in the normal mode, the inbox counts it as said by the agent, and model markup gains `from`/`thread`/`context` attributes — that is, what the model reads changes.

Threads named by the background call come from its mapping's `reference` display (`referencedThreads`): in a native tool from the outcome display, in an operation over HTTP and MCP from its answer's `_meta.toolDisplay`. They are stored in the call's debt line until delivery: the notification assembles later, from the line.
