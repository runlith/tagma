---
id: 01a10284-da13-7e0c-9742-a43017ef39ee
title: A cold open of an unloaded thread reads a transcript window without restoring the whole history
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe2273f0f381",
    "status": "done"
  }
edges:
  - kind: waits-on
    to: 01a10284-da13-7e0c-9742-a42ac9c48cea
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/fold.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/restedFolds.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/restedReads.ts
---
**What.** Opening an unloaded thread reads a transcript window without restoring the whole history.

**Why (perf audit 2026-10-03, from code).** `native-harness/transcript/fold.ts:43-55,111-116` → `restedFolds.ts:28-89` → `threads/journal/restedReads.ts:131-140`: on a cold miss the rollout is read from byte 0, every event JSON-parsed, transcript and model history folded, the whole result reserialized to weigh it (`JSON.stringify(source.history)` and of every entry), and only then does `windowFrom` take the page. A fold over 128 MiB does not stay held — every next page repeats the full pass; concurrent cold reads do not merge. Cost is O(all rollout bytes + model history) per window of a few entries.

Measured alongside: `ThreadFeeds.open` at 15:00–15:32 UTC — 45 completions, p99 ≤8192 ms; `0a1e72420ddccc83` — 6196 ms, of which one `sql.execute` 6020 ms (`select "ord","entry" from "thread_entry" where thread_id=? and ord in (…)`, plan — PK SEARCH; the cost is in entry volume and loop stalls, not the index).

**Direction.** The journal and fold owner keeps an addressable transcript projection or checkpoints with offset/ord; the window reads without restoring model history; weight is computed when the data is created. Withdrawal, rewind, and entry revisions stay correct.

**Done when.** A cold window open reads O(window) bytes; the transcript matches the old fold, including withdrawal and rewind.
