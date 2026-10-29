---
id: 01a163a2-6386-7fab-80e4-e95e47c48af3
title: "Measurement: tsc-rs versus tsgo as the navigation engine on runlith"
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a163a2-bca3-7caa-b201-d8c12348ae1a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Operator decision: measure whether tsc-rs (Rust port of TS 7, pingdotgg/ts-rust, same `--api`) is a better navigation engine than tsgo — on our load, not the author's numbers. The outcome picks which engine to keep and fork. Compare on one TypeScript revision (tsc-rs is pinned to 7.1.0-dev fed0bf24149f — base tsgo on the same revision): compatibility with our API client and worktree layer, the 74-place benchmark, cold start, warm answers, post-edit and post-idle answers, memory, `GOPORT_FAST` mode. No product code changes; the result is a note with numbers for the spec.
