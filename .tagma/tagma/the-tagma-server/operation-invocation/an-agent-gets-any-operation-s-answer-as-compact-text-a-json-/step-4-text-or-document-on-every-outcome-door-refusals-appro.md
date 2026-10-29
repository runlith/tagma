---
id: 01a15ec6-7725-744e-8aee-d254afdbdf08
title: "Step 4: text or document on every outcome — door refusals, approval, background, recovery, negative"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
---
Done: recovery after a restart hands over the voice text (f7e48f02df); a voice failure hands over a document with a line (f7e48f02df); negative in the native door is an unsuccess verdict through `answeredOutcome` (30b6667085), in the bridge it is `isError` (in uncommitted `mcpServe.ts`). Left: door-drawn outcome texts in `packages/agent` (`unexecuted`, `stoppedAnswer`, `backgroundReceipt` in `ToolExecution.ts`), the approval refusal on the hosted road (`ThreadHosting.ts:519–529`), the final background notification in the call context with the `json` choice in the debt line (`invocation/detach.ts`).

Spec points 6 and 8: outcomes drawn by the door in `packages/agent` go through one outcome-line function; the final background notification draws in the call context with the `json` choice in the debt line; a recovered call gets the voice text; the `invocation` result carries the outcome, and negative is handed over as a failed call; a fallen voice hands over a document with a failure line.
