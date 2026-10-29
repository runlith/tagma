---
id: 01a16fd0-c5ba-7b0b-963a-58a127686a0f
title: A published page is a card of its version in the feed with a player for motion, and a right-area tab that follows the new version
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/pages
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/artifacts.ts
---
## What the operator sees

An agent called `publish_artifact` — a card of its version stands in the feed under the tool row (the feed tool view keeps its row: status, input and output disclosure):
- header: title, dimmed description, version publish time;
- body: this version's page. A document is a fixed-height preview with no feed-wheel scrolling; it opens for reading in a tab. Motion is in the scale-declaration proportion, with a player under it;
- actions: "To panel", "Open in browser" (the `Links` route: the built-in browser panel or the system browser per `browser.openLinks`), copy address.

The card shows the version its call published. When the same page is published again, the page's old cards collapse into a "replaced with a new version" row with disclosure: ten edits never make ten playing clips in a row. A version the shelf no longer keeps is drawn as a "version not kept" card with a hop to the current one, not a gray server page.

"To panel" opens the `artifact` tab right of the thread. The tab shows the current version and moves to the new one itself on republication, surviving reload.

## Player

Under motion in the card and tab: play/pause, frame slider, time, repeat, frame step with arrows, fullscreen. Motion plays itself when the card appears, and stands on the last frame at the end. The player sends `seek(k)` only on k change (never leaves the grid at 120 Hz) and holds one `seek` in flight. A motion frame has no pointer: clicking it is play/pause, and Space and arrows never sink into the iframe. Transport is factored into a shared component from `CallPlayer.svelte` and moves calls onto it in the same change ([[dd380bf6]]).

## How built

- **The tool answer** also carries `id`, the version address, and the version scale; the card draws from the feed record, with no second request.
- **Frame.** Shared `Frame` (`features/views/Frame.svelte`): iframe, sandbox, height with ceiling, parking on removal; protocol attached by a `FrameLink` factory. `ViewFrame` stands on it with `ViewBridge`, a page with the scale bridge (`TimelineBridge`) or no protocol for documents. Visibility mounting is given by the feed virtualizer; the frame has no visibility observer of its own.
- **Remote door** serves `/a/…` with `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` instead of `'none'`/`DENY`: otherwise the card from a phone would never load. Together with the CSP `sandbox` this works: `'self'` is checked against the answer's address origin (verified in Chromium and WebKit).
- **Record view.** `ToolKind` in `@runlith/chat-ui` gets a view predicate: `registerTool` for `publish_artifact` draws the card only on a successful answer with `id`; a failed call and old records stay a plain row. This chat-ui change belongs to this work. No `keepAlive`: off-window the row unmounts, no more live frames than mounted rows.
- **Reading a page by id** from `artifacts` (the parent spec) gives the card "current / newer exists / version not kept" and the tab the current version.
- **Tab** is the `artifact` view in `features/pages/panes.ts`, id is the page id. `stands` reads the page by id; `null` while no answer means the layout never wipes. `admits` undeclared: the tab opens only from this thread's card.
- **Version cache.** `/a/<id>/v/<version>` is immutable — `cache-control: immutable`; the current-page address stays `no-store`.
- **`artifacts` skill.** Publishing section: in a native thread the operator sees the page as a card, no need to repeat the link; where there is no card, give the link.

## Acceptance (performer)

- `publish_artifact` in a native thread and at a Tagma agent on ACP gives this version's card; a failed call is a plain row.
- On republication: the old card collapsed into "replaced", disclosing into its version; the open tab moved to the new one with no operator action.
- After 21 publications of one page the first card draws "version not kept".
- The tab survives window reload.
- From a phone via the remote door the card loads the page through the door in a sandbox; copying gives the door address.
- Motion in the card: play, pause, slider, frame step, repeat, fullscreen; slider frame k matches frame k from [[0fc6fa99|time frames]].
- Test: the `publish_artifact` answer through the tool door carries `id`, version address, and scale.
- [[2e1bad5a]] and [[01208e3e]] fixed, card and tab described.
