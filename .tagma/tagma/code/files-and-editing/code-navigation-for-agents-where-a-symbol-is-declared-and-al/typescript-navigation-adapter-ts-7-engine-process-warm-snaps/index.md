---
id: 01a16160-39ce-7163-bb84-009b753b9d92
title: "TypeScript navigation adapter: TS 7 engine process, warm snapshots, verdicts by position, alias and definition"
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16167-afd2-77b1-bc67-9aa426ed792e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
  - kind: waits-on
    to: 01a16160-10e4-70a6-b29a-fe8035b3ac59
---
New kit `packages/navigation-ts` against the navigation kit contract: engine process entry (an `typescript/async` client with a child `tsc --api` inside it, kit NDJSON-RPC frames), serving a warm snapshot and background warmup of the newest revision, holding the warm snapshot in a quiet checkout, verdicts with kind and function by positions, TS 7 reference search, `definition`, alias by the spec definition (directed value flow, type projection, depth 2), the `['Service']` rule for Effect service owners, recognition of degraded projects and missing `node_modules`. The MVP stand `packages/code-nav` and probe scripts are experience, not code to carry over. Checks are on a small sample repository.
