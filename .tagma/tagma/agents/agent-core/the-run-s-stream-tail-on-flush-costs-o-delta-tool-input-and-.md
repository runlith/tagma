---
id: 01a102b7-3835-79ee-b3d7-2c6aef95d53d
title: "The run's stream tail on flush costs O(delta): tool input and text never reparse whole"
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e88-78a0-b17d-3889571d4916",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10284-da13-7e0c-9742-a42ff8547949
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStreamParts.ts
---
**What.** A run's stream tail (`ThreadStreamParts.tail`) costs O(delta) on every flush, not O(all open text and tool input).

**Why (found while working on [[f8547949]], from code).** `packages/agent/src/thread/run/ThreadStreamParts.ts` on every flush (`streamFlushIntervalMs`) for every open part:
- runs `cleanText` over the whole text and reasoning: `replace` and `trim` across the whole line;
- for a tool input held as text (`held.kind === 'text'`) calls `readPartialJson(open.inputText)` — a full reparse of the accumulated input;
- rebuilds the whole tail, which is then rewritten whole.

Flush cost is O(L) over the accumulated, O(L² / bytes per flush) over the whole stream. A long `write`, `edit`, or `apply_batch` and a long assistant answer yield megabytes of repeated parsing synchronously on the server event loop. That breaks rule [[7a910861]]. The threshold past which `retainOpenInputs` moves the input to a file needs reading: below it the parse runs every time.

**Direction.** The open part holds an incremental `partialJsonReader` (`packages/utils/src/json.ts`, after f15a5083c1 it builds the value at O(delta) and preserves identity) and receives `push(delta)`. Text cleanup travels the delta. The tail writes as a delta wherever the `streamTail` contract allows.

**Done when.** A flush with a new delta re-reads and re-parses nothing accumulated. The tail and the final transcript match the old ones. An isolated stream-input measurement at 256 KB and 1 MB shows linear total cost.
