---
id: 01a185bb-35a6-7d09-9757-f68459bf3c8f
title: An audit's frame partials keep axe-core's depth-first order, and the root partial never leaves its renderer
ord: 39
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/audit.ts
---
axe-core's `finishRun` matches partial results to frames by order alone: it walks them depth-first, giving each the next frame its parent's partial listed. The engine therefore asks each frame for its child frames (`getFrameContexts`) immediately before that frame's `runPartial`, audits children in that order, and when a child fails it drops whatever its subtree already contributed and stands one `null` in its place; a missing or extra entry would attach every later frame's nodes to the wrong frame selector, and the refs resolved from those selectors would point at other elements.

The root frame's partial is kept in its own isolated world and `finishRun` runs there, so the largest partial never crosses to the server; only other frames' partials travel, base64 of their JSON so the server passes them on without parsing or escaping (escaping JSON text on the way out cost about 2.5 ms per MB against 0.25 for base64, one sample on an Apple M2 Max). The answer is cut to the node limit inside the page before it returns, so what the server parses is bounded by the limit, not by the page.

Failing nodes come back as axe-core selectors and are resolved to refs after the run, so a ref is issued only while every frame on the node's path still holds the document it was audited in; a frame that navigated meanwhile answers a null ref rather than an element of the new document. A node replaced inside the same document under the same selector resolves to its replacement.

Isolation holds because axe-core lives only in the engine's isolated world, and messaging is switched off (`allowedOrigins: []`): partial runs need no frame messages, and the page's own `postMessage` traffic cannot reach axe-core's listener.
