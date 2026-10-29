---
id: 01a146a3-b69e-7701-8802-1c7c467f23ab
title: "Thread fork: instant answer in the interface, and copy cost in bytes in SQLite, not in thousands of requests"
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14697-d1f4-7e38-b60f-440c7ce99c9f",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadBranch.ts
---
Forking thread `01a125fe` (7 852 transcript records, 34 MB) took ~12 s on the server on 16.10, and the menu stayed open all that time with a grey "Fork" and no indicator.

Measured by the born thread's marks `01a14695` (no span on the operation):
- 1.4 s — `prepare`: the whole transcript is read from SQLite and parsed in JS;
- 8.3 s — 7 843 `journal.append` calls one by one inside a single record: 4–5 requests to the SQLite process per row (~30k), with the machine writer held all that time;
- ~2 s — commit, moving 7 843 rows into the new thread's rollout (40 MB jsonl), then the answer.

Causes and where they live:
- `ThreadBranch.fork` (`packages/agent/src/thread/run/ThreadBranch.ts`) copies the journal through JS row by row — cost grows with record count, not with bytes;
- its `prepare`/`bear` loop prepares outside the record and retries on a version shift up to `TRANSITION_PATIENCE_MS` — a working source starves the fork into the "kept moving… nothing was born" refusal (the same one [[59b927cd]] fixed for transitions);
- `branch_thread` has no span, `ThreadBranch.fork` is `fnUntraced`: the fork is invisible in telemetry ([[72839a8a]]);
- in the thread menu `onclick` synchronously sets `busy`, and bits-ui sees `disabled` after it and does not close the menu; same for Pin/Archive/Detach.

Result: `4826a62ce6` (menu and visible fork, [[ed0201b2]]), `098f9378f2` (set-based copy, retry without starvation, a span on each operation, [[1020c14d]]), `684da89db0` (child FTS and rollout after the answer, [[6f5b4b73]]). Bench on a synthetic 8.8k-event / 29 MB source: answer 41.7 s → 0.56–1.02 s, writer in the answer 33.7 s → 0.49–0.91 s, child index and rollout ready in 2–3 s. Not proven: measurement on the real `01a125fe` thread and a live window (needs the operator's server restart); a write outside the lane in the first seconds before export ends will refuse and is flushed by the next write (note [[8fdaec3a]]).

Done when both child tasks close with commits. An instant fork independent of size (a link to the source journal prefix) is a separate spec.
