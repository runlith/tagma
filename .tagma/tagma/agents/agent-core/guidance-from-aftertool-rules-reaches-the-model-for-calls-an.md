---
id: 01a18936-d2a2-7c93-82d2-ef6195533681
title: Guidance from afterTool rules reaches the model for calls answered after a parked approval or in the background
ord: 202
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18906-5946-7cc1-afe1-26ad429018a5
sources:
  - kind: file
    ref: packages/agent/src/thread/run/parkedDoor.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
---
An `afterTool` rule's guide lands in the live loop's `stepGuides` only. A call executed by the door a parked approval rebuilds gets no guide sink (`parkedDoor.ts` passes no `onGuides`), and a call running in the background skips `rules.guide` on purpose (`ToolExecution.ts`), so their guidance is computed and dropped: a plugin's `PostToolUse` `additionalContext`, the touch rule's law briefs and capability cues never reach the model for those calls. The guidance needs a thread-owned, recorded road that the next run of the thread reads, the way a late background outcome reaches it as a notice.