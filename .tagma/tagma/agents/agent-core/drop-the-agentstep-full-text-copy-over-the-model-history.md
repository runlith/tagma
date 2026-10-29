---
id: 01a10348-76c3-77c7-8c6f-b6ca9764395d
title: Drop the AgentStep full-text copy over the model history
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a102a0-ea9d-7680-8a9d-2512e74ab22a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10284-da13-7e0c-9742-a4318dd9eca9
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentStep.ts
  - kind: file
    ref: packages/agent/src/agent/turn/fold.ts
  - kind: file
    ref: packages/agent/src/thread/run/liveHeap.bench.ts
  - kind: symbol
    ref: packages/llm/src/llm/schema/events.ts
    symbol: LLMResponse
---
Drop the separate full-text hold in `AgentStep` over the model history, keeping the `AgentRunOutput`, `stopWhen`, and closing-hook contracts. The cause was the re-joined text in the `LLMResponse.text` getter, whose result `agent/turn/fold.ts` kept beside the already-assembled message. Now the `LLMResponse` owner reuses the existing text/reasoning-part string when its length and every fragment exactly match the delta stream. At most one candidate is checked; cost is linear. With a different part order or different content, the delta-order assembly is kept. Public fields are unchanged, there is no consumer cache; `foldStep` reads reasoning once. Parts whose combined text is a separate string still need that aggregated string.

Isolated `packages/agent/src/thread/run/liveHeap.bench.ts --steps`: a real `AgentRunner` with a synthetic `ModelRequester`, 128/256 tool steps of 256 KiB with 100 text deltas of ~1 KiB each, then a closing step. Runtime closed, steps/AgentRunState roots removed separately from the last request history, heap read after GC. Over 3 cold processes: the result adds **13.626–13.629 / 27.953–27.964 MB** over the model history. The `--without-text` control, keeping the remaining step fields, cuts the addition to **0.114 / 0.221 MB**. The `--deltas=0` control gives at most **0.214 MB**: no further large extra copies of tool bodies on this path. The 50 KiB of tool-result text per call landed in the model history; the full original 256-KiB body as a separate model row is not promised here. This is a reading of the result object graph, not a live-server measurement.

After the fix the same ordinary mode `liveHeap.bench.ts --steps --turns=128|256`, with the bench unchanged: **0.083–0.113 / 0.214–0.216 MB** of result over history across three cold processes. The megabyte copy is gone; fields and references of the result remain. Covered: 9 response-projection tests (spaces, split Unicode, interleaved parts, differing message content, model change), 99 AgentRunner tests including stopWhen and the closing hook; `llm` and `agent` typechecks, inspections clean. The source commands from `packages/agent`: `bun run src/thread/run/liveHeap.bench.ts --steps --turns=128`, then `--turns=256`; controls add `--without-text` or `--deltas=0`. Reasoning was not generated in the heap workload; its semantics are covered by unit tests.
