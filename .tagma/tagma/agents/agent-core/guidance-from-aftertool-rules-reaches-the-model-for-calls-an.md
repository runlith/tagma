---
id: 01a18936-d2a2-7c93-82d2-ef6195533681
title: Guidance from afterTool rules reaches the model for calls answered after a parked approval or in the background
ord: 202
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18907-f521-7d45-8045-92646bda8dc1",
    "status": "in_work"
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
An `afterTool` rule's guide landed in the live loop's `stepGuides` only. A call executed by the door a parked approval rebuilds got no guide sink (`parkedDoor.ts` passed no `onGuides`), and a call running in the background skipped `rules.guide` on purpose (`ToolExecution.ts`), so their guidance was computed and dropped: a plugin's `PostToolUse` `additionalContext`, the touch rule's law briefs and capability cues never reached the model for those calls. The guidance now travels with the call's recorded outcome, which the thread's next run reads.