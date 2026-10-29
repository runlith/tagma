---
id: 01a1700e-a570-7ea9-9b7f-2f7b1afa93b4
title: "The `Render` port shoots a timeline page frame: an ordered frame stream from host targets, the page served by document interception under the shelf CSP, readiness by facts"
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16fd0-c677-7a15-b69a-41860fc6fa99
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/contract/service/render.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/render.ts
  - kind: file
    ref: apps/tagma/server/src/page-render/stage.ts
---
`artifacts` knows no browser: it declares the `Render` port and decides what to shoot, while `page-render` fills the port over `browser` hosts. `Render.frames` is a stream of frames in request order, not an array: the next frame is shot only after the consumer took the previous one, so a clip with a streaming encoder holds memory flat for any frame count, and its progress is the count of received frames. `targets` opens that many targets with the same page and deals frames to a free target: a frame is a function of t only, so shooting order across targets does not affect the picture, while the stream still delivers frames in order. Targets live until the stream ends; an interrupted stream (a cancelled clip) closes them.

The page reaches a target through document-request interception (`Fetch.fulfillRequest`) at an address absent from the network, not through the shelf's HTTP door: a draft on the path never becomes a version, no temporary route is needed, shooting does not depend on whether the pages door is up in that process, and versions and drafts travel one path. The answer carries the same CSP the shelf serves (`pagePolicy`), together with the remote door's `sandbox`: the document gets origin `"null"`, as in a card frame without `allow-same-origin`, and `localStorage` that throws in a card throws while shooting too, so the agent sees the refusal in self-check, not in the feed.

A browser-launch or shooting-target failure arrives as `browser-unavailable`: its way out belongs to the browser, not to fixing HTML. Readiness is by facts, with no deadline ([[7609a86c]]): a `Runtime.exceptionThrown` before readiness is a `page-failed` refusal with the exception text; after `load`, no `window.tagmaTimeline` means a page without a fragment; otherwise we await `tagmaTimeline.prepared` through `awaitPromise`, and its rejection is `page-failed` too. While the page loads fonts and images the wait is unbounded; a target session end or a document-serve failure before readiness is a fact too and also `page-failed`, otherwise a `load` wait in a vanished browser would never end. The document encodes to base64 once per stream, not per target: this is work over one page, it belongs on the loop (20 MB of HTML is ~13 ms of base64 and ~8 ms of command serialization, one sample, M2 Max). A frame: `seek(t_k)` with `awaitPromise` (an async `render` shoots after resolving), two rendered frames, `Page.captureScreenshot`. The target sets the size: the declared viewport `width×height` and `deviceScaleFactor` — the fragment stages the scene at scale 1, and a DPR below 1 rasterizes the same layout into fewer pixels, so a 960 px frame is the same frame, not a recompressed picture, and no PNG re-encode on the server is needed.
