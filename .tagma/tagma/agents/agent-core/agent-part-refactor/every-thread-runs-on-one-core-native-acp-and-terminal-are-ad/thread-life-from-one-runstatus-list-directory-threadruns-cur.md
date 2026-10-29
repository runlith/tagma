---
id: 01a11ca5-7ddf-7f42-a891-bd67d38667ed
title: "Thread life from one RunStatus: list, directory, ThreadRuns.current, read_statuses and read_endings, app; keep-warm and time accounting by runs"
ord: 18
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b1570382ca
---
Done: `053a460bc4`, `82d36d2967`, `a9c446aa82`, `946745d443`, `3a631cd77e`, `78f9c0e230` — unified run signals and life readers, batched statuses/endings, app surface, keep-warm and RunCount/Awake; act and core-beat costs are covered by tests.

Remainder on the [[570382ca|scale spec]]: lazily restore a resourceless run. Right now `external-harnesses/serving.ts` raises every standing terminal resource at boot via `resource.watch` and `sessions.recover`, instead of on first launch. Start from `external-harnesses/sessions/drive.ts` and `store/sessions.ts`; measure a full beat and terminal/ACP recovery, including SQLite rows read and lease updates, as thread and resource counts change. The ACP idle policy is out of this task.

Proof of completion: an integration measurement of calls, rows read, and writes shows act and beat cost by the work touched, pages by their size, and recovery by running runs and standing resources; boot/launch and idle-resource writes match the clarified contract. The revision read code and tests and ran nothing new.
