---
id: 01a17af8-7588-7417-8db8-28c33040f6fa
title: "A hosted thread after compression by another model loses disclosed deferred tools: the call refuses `No such tool available`"
ord: 149
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a2d-46a6-7f14-ae04-5762530f3ee7",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a10a1a-ee85-7fd6-b885-d18d92391518
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/protocol/journal.ts
    symbol: eventsOf
  - kind: symbol
    ref: packages/agent/src/thread/run/SummarizerRouter.ts
    symbol: lineageOf
---
A Claude Code (ACP) hosted thread calls an earlier disclosed tool after compression by another model and gets `No such tool available`. Example: thread 01a16e20-3dd6-7696-901e-d29696ccb336. `send_task` was disclosed and called (#6578, #6608); a muse-model compression followed — #6722, `own: false`, the fold head carries `metadata` with only `{origin: "summary"}`, no `toolReferences`; on #8028 the call refused. The own model carries names over (`foldedReferences`, [[92391518]]), but the foreign road (`ThreadCompactionRuns.work` → `lineageOf`) loses them for a hosted thread — the place is unfound, that is the conclusion. Find the cause, fix it at the owner so disclosure survives compression on any road and any transport, test through the same door — red before the fix.
