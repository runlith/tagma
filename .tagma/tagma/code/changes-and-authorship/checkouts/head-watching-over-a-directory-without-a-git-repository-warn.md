---
id: 01a155fa-9869-769a-b1fb-e703af0f1075
title: HEAD watching over a directory without a git repository warns on every backoff step
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13d58-e5af-7b43-8425-23fcd7a280ad
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/watch/heads.ts
    symbol: makeHeadWatches
---
In a 0.1.5 user's serve.log, 230 `HEAD could not be read; observation will recover` lines over seven hours for `~/.tagma/global` with `fatal: not a git repository` (the `holdings.subscribe` subscription). That user's global-graph directory is not a git repository, and reading HEAD there will never recover: it is a fact about the place, not a read failure. `workspace/watch/heads.ts#read` treats any `commitOf` refusal as transient and retries with a backoff up to 60 s, warning every time.

Where to start: who opens HEAD watching for a place without a repository (the global place's holdings subscription) and what the subscriber needs there instead of HEAD. No repository is a proven answer to the subscriber, not a retry.

Done: a holdings subscription on a place without a repository writes no warnings and does not retry the HEAD read.
