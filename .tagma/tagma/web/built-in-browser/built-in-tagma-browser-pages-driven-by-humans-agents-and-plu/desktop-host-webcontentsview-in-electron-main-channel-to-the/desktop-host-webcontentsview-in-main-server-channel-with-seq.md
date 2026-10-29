---
id: 01a147d6-7ef4-7c9c-9e39-feab93cb7437
title: "Desktop host: WebContentsView in main, server channel with seq, page policies, parking, keys, and identity"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0e255c4582
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-fea9ce0f09a0
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
sources:
  - kind: dir
    ref: apps/tagma/desktop/src/browser
  - kind: dir
    ref: apps/tagma/server/src/desktop-browser
---
Build the [[93cb7437|desktop host]] without freezing under layers (that is a separate task): the server `desktop` adapter and its wire, the `attach_browser_host` feed and the report stream with `(host, generation, seq)`, `WebContentsView` pages in profile partitions, policies, the profile service session, parking and `painted`, memory unloading, the `tagmaDesktop.browser` bridge, main chords and renderer-chord forwarding, identity. Electron experiment outcomes accounted for.

Done when: channel integration test against a fake host and system tests under real Electron from the [[255c4582|spec]] pass; `bun run typecheck` clean; review done; commit via `submit_work`.

Main event loop lag measurement (one sample: macOS arm64, Electron 44.8.0, 10 ms timer; probe not saved and irreproducible from the record). Idle: p50 ~11 ms, p99 12–28 ms. 15 fps broadcast of a network-loaded page, 10 s: 148–150 frames, p50 11 ms, p99 13–30 ms, max 16–43 ms — no binary route needed for frames. Full-snapshot loop of a ~24k-node page: 33 MB accessibility tree, renderer ~3 s per tree, `JSON.stringify` of the answer in main 28–91 ms, p99 19.7 ms, but max 1343 ms — a single main stop on an answer of that size. In one pass the tree took 5.35 s, and the responsiveness probe declared the page hung — at the engine, [[475a615c]].
