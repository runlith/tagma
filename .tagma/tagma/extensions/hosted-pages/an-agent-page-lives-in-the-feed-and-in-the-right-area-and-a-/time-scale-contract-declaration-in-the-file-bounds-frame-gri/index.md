---
id: 01a16fd0-c615-79b4-a01d-8b0d3e6b0ad9
title: "\"Time-scale contract: declaration in the file, bounds, frame grid, and page fragment by which frame k is the same in the feed, the frames, and the clip\""
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/artifacts/contract/wire
---
## Why separate and first

The card, player, frames, and clip must agree on what counts as a motion page, how big it is, and which frame stands at t. This is the `artifacts` module contract in its wire (`artifacts/contract/wire/timeline.ts`) plus the page fragment the skill gives verbatim.

## Declaration in the file

A page declares the scale statically: `<script type="application/json" id="tagma-timeline">{"v":1,"duration":6,"fps":30,"width":1920,"height":1080}</script>`. The shelf reads it at publication, verifies it against the schema, and stores it in the version record; the `publish_artifact` answer and page reading by id carry it. That is how the card knows the proportion and that it needs a player before loading (the feed row never jumps), while frames and the clip refuse before the page opens if the input is bad.

**Schema bounds** — otherwise one clip would hold the machine for hours: `fps` from {24, 25, 30, 50, 60}; `duration` above 0 and at most 300 s — the ceiling of an explainer clip and an intro, longer is already video, not motion; `width`/`height` even (an H.264 requirement), each side 16 to 3840. An invalid declaration means publication passes as a document, the answer gives the reason for the agent to fix.

## Frame grid

N = round(duration · fps), frame k stands at t_k = k / fps, k = 0…N−1; the last frame is t = (N−1)/fps. These formulas live in `timeline.ts`; the player, frames, and clip read them: frame k in the feed and clip frame k are one and the same.

## Page

- **Fixed-size scene.** The page lays out in a `#stage` element of `width×height`; the fragment scales it to the window with `transform: scale` and centers it. So wraps and sizes match in a 600 px-wide card and a 1920×1080 export. The fragment stands at the end of `body`, after `#stage`.
- **One theme.** Colors explicit, motion never reads `prefers-color-scheme`: otherwise a dark app and headless browser would give different frames.
- **Materials inside.** Fonts and images are only `data:` (the CSP lets them through); with no network the clip captures the same as the feed.
- **`window.tagmaTimeline = {seek(t)}`.** The agent writes a frame function `render(t)` (global, may return a Promise if the frame needs to load something); the fragment's `tagmaTimeline.seek(t)` calls it and resolves when the frame is drawn. Renderings are serialized: the last requested frame draws last.
- **Readiness on facts.** After `load` the fragment calls `FontFace.load()` for all `document.fonts` and `img.decode()` for images, draws frame 0, then sets `tagmaTimeline.ready = true` and sends the parent `{type: 'tagma:ready'}`. The same fact is the `tagmaTimeline.prepared` Promise: resolves on readiness, rejects on setup failure; CDP capture awaits it with `awaitPromise`. On the parent's `{type: 'tagma:hello'}` the fragment answers `tagma:ready` if ready: the host sends hello on frame `load`, so readiness never gets lost on repeated mounting.
- **Determinism.** A frame is a function of t only: no `Date.now`, `performance.now`, or unseeded `Math.random`. CSS `@keyframes` animations allowed: on every `seek` the fragment pauses and sets `currentTime = t` on all `document.getAnimations()`; the place on the scale is set by `animation-delay`. The fragment finishes CSS transitions (`finish()`): a transition has no place on the scale. GSAP is a `paused: true` timeline with `seek`, Lottie `goToAndStop`.
- **Outside Tagma.** A page opened by itself runs its own time until the first external `seek`; the first `seek` (by message or directly via CDP) switches its own clocks off forever. That is how an export opening the page as the top document never argues with its clocks.

## Bridge in the frame

The host sends `{type: 'tagma:seek', k}`; the page draws frame t_k and answers `{type: 'tagma:frame', k}`. The host holds one `seek` in flight and sends the next after the answer: a slow page never queues, and the slider shows exactly frame k.

## Acceptance (performer)

- The schema accepts the skill's declaration and refuses past bounds (odd size, fps outside the set, duration over 300) with a reason in the publication answer.
- The version record and `publish_artifact` answer carry the declared scale; a page with no declaration has no scale.
- A page per the fragment verbatim, opened as the top document: after the first `seek(k)` two captures in a row are identical (its own clocks stand).
- `seek` with a Promise: the capture taken after its resolution.
- Both browser criteria are proven by the [[0fc6fa99|time-frames]] itest: it captures the fragment page with the same capture the frames and clip use.
- An #explanation of the scale contract stands on `artifacts/contract/wire/timeline.ts`.

## Where it stands

Schema, bounds, and frame grid are `artifacts/contract/wire/timeline.ts`; the declaration and the fragment the skill gives verbatim are `fragment.ts` beside it; the shelf calls `artifacts/declaration.ts` to parse the declaration at publication. Counted here too are the parent spec's shared things: the `publish_artifact` answer (`contract/wire/published.ts`: `id`, `versionUrl`, `timeline`, `timelineProblem`) and live reading of one page by id — the `artifacts.page` feed (`{current, kept}`: the current record with scale and kept versions), which the clip extends with export state.
