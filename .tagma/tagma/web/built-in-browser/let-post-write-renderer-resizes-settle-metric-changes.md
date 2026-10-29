---
id: 01a186c3-582e-7784-8e03-e299b28dd0c2
title: Let post-write renderer resizes settle metric changes
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18627-3d95-7c84-bfb1-c1ee81a96b0b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18665-6e4c-77bc-b17d-806af99cd9bd
---
Accept an exact normalized match or a post-write renderer resize; on clear require a change from the revision-stable pre-write renderer size, regardless of hidden native resizing. Preserve parameter-only matches without accepting unchanged, non-matching reads. Both public-operation regressions hit the unchanged 180 s guard at b89941c01f and now pass through emulate_page and evaluate_in_page (red reports run.60252.1793263626259.jsonl and run.60254.1793263626338.jsonl in /tmp/runlith-test/reports). automation.test.ts passed 11/11 on seeds 1/2/3; the whole managed engine and screencast passed 40/40 on seed 1, report run.70560.1793264341773.jsonl; bun run typecheck passed. One Apple M2 Max managed-browser sample: set 2 ms, clear 1 ms, refused change with rollback 11 ms, no-op clear 0 ms at millisecond resolution. Desktop behavior was checked by source and the controlled public-operation/CDP fixture, without launching Electron. A normalized mismatch with no qualifying post-write resize remains lifetime-bound as [[67de2527]] explains.
