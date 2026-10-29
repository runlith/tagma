---
id: 01a0db83-450e-744e-ab4d-fee1540cd012
title: "The compaction row names its summarizer from its first frame: the running entry carries the summarizer resolved when taken, and the row reads it as its subject"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0db83-6344-7a6d-8cdd-81ad9a671e7c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d980-451f-7376-b8a0-a342478a03df
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/compactionWords.ts
  - kind: file
    ref: packages/chat-ui/src/timeline.ts
---
Operator report (2026-09-26, two screenshots): after a manual `/compact` with Muse Spark 1.3 picked, the live feed shows `Compacting the context · manual · 7s · run 7s` under `Finished in 15s` — the running label, running clocks, and no summarizer. The stored record is right: `GET /api/threads/01a0d942-aba0-714f-b0f2-4d2619b18696?project=5` carries `status: completed` and `summarizer: {model: muse-spark-1.3-contributor, …}` on `compaction:01a0db7b-c6cb-7122-abef-7b8df2fd2114`, and `entriesFromTranscript` projects it with `compactionSummarizer`. So the live client never folded the completed transition, while a snapshot with the finished run did arrive (the run-end row is drawn).

Reading of the evidence (2026-09-26): the screenshots show thread 01a0d3dc 7 s into a live compaction (02:11:26–02:12:01); `Finished in 15s` is the end row of the turn before it (01:04:49–01:05:05), and `run 7s` is drawn only on a live row. Events 4087 (running) and 4088 (completed) stand back to back and the live fold settles them, so step 1 found no defect; what the operator could not see is who compacts.

Do:
1. Reproduce the stale running row in a test at the owner (ChatTurns/ChatFold/ChatTransport or the server's thread channel/evidence), find which producer drops or overwrites the completed compaction delta, fix it there.
2. The running compaction entry names the summarizer resolved when the compaction was taken (server writes it on the `running` transition), so the reader sees who compacts before it ends.
3. The row reads the summarizer as its subject, e.g. `Compacting the context with Muse Spark 1.3` / `Compacted the context with …`, plus quota and skipped facts as today; a compaction by the thread's own model says so.

Done when: a live manual compaction with a non-own summarizer shows the summarizer from its first frame and settles to `Compacted … with <model>` without a reload; tests cover the settle path; claims 7f407f81 and 04e70520 reconciled.