---
id: 01a123b0-f0b8-7505-af77-37f088151d7d
title: "The pins contribution point: declare at threads and pin the manifest's plugin view"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4fb-7781-90d4-f033d7a6365c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1236e-0adf-7dc2-babd-bb78eea92af2
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The `pinContributionsSchema` stands in the `threads` wire (`threads/contract/wire/pins.ts`), but no one declared the `pins` point through `PluginPoints.declare`: a manifest with `contributes.pins` now refuses with “unknown point”. A pinned view mounts (`pins.feed.svelte` → `PluginView`) once the thread pinned it with `pin_view`; the point must decide what `pins: [{view}]` means in the manifest (which plugin views may be pinned, checking that `view` is declared in `views`), and declare itself from the `threads` layer.

Done when a manifest with `pins` installs, `pin_view` of a view not named in `pins` refuses with a cause, and an integration test shows it.
