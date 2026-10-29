---
id: 01a18353-fb8c-7866-916b-78b406aa5d8d
title: "Feed stand: the real ChatSurface over a 10 000-entry synthetic thread, its invariants as e2e assertions and a quiet-window frame budget"
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: dir
    ref: packages/chat-ui
---
Part 2 of [[2ea21922]] on the stack of [[7111dc21]]: a stand page in `packages/chat-ui/stand` mounting `ChatSurface` over synthetic data with scripted streaming and page latency; a per-frame recorder reading DOM rects of text sentinels; the scenarios and invariant budgets of the spec as `*.e2e.ts` assertions on the Chromium, WebKit and iOS lanes; a quiet-window command measuring frame time. A comparison with the branch base is not part of this task (the operator's word, 2026-10-29). The operator allowed the stand's browser runs (2026-10-28).