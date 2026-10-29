---
id: 01a16ff4-762e-736e-a585-7685730d307b
title: "\"Page frame k on the scale is the same in the player, the frames, and the clip: the grid and declaration in wire, the page side one fragment\""
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/contract/wire/fragment.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/contract/wire/timeline.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/declaration.ts
---
Motion-page frame k is `t_k = k / fps` per the declaration from its own file, and the same frame k is drawn by the card player, the time frames, and the clip. So the grid (`frameCount`, `frameTime`, `frameAt`) lives in one place, not with each consumer: a player counting a frame from elapsed time its own way would show a different frame on the slider than the one that lands in the clip.

The declaration is read from the file at publication and lies in the version record, not taken from the loaded page. That is how the card knows the proportion and that it needs a player before loading (the feed row never jumps), while frames and the clip refuse before the page opens. An invalid declaration never refuses publication: the page becomes a document, and the answer names what to fix. Schema bounds are machine protection, not taste: fps from a short set, up to 300 s, even sides 16…3840 (H.264 cannot encode odd ones) — otherwise one export would hold the machine for hours.

The page side is one fragment (`TIMELINE_FRAGMENT`), which the skill gives verbatim and which tests use: the agent writes only the declaration, the `#stage` scene, and `render(t)`. The fragment serializes rendering (the last requested frame always draws last, even with async `render`), parks all `@keyframes` animations at `currentTime`, and finishes CSS transitions to the end: a transition has no place on the scale, its time depends on the style-change moment. Readiness is the `tagmaTimeline.prepared` fact after load, fonts, and images; via CDP it is awaited with this Promise, and a frame in an iframe is the `tagma:ready` message, which the fragment repeats on `tagma:hello` so readiness never gets lost on repeated mounting. The page's own clocks, opened by itself, order the next frame only after the previous one is drawn (a slow `render` skips frames instead of queueing before the first external `seek`) and die forever on the first external `seek` — otherwise the top document's capture would argue with them.

The server counts as the declaration exactly the element the fragment's `getElementById` finds: a `<script>` with an `id` attribute equal to `tagma-timeline`, case-sensitively, outside comments. Otherwise the version record would have named a motion page whose fragment would fail.

The host holds one `seek` in flight and sends the next after `tagma:frame`: a slow page never queues, and the slider shows exactly frame k. The sandboxed frame page has no `allow-same-origin`, its origin is `"null"`, so the host sends `postMessage(…, '*')` while the page accepts only messages from `parent`.
