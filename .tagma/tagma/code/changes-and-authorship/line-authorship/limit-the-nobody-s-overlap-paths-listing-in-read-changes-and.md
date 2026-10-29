---
id: 01a14c70-9f54-7756-8eef-14c589008526
title: Limit the nobody's overlap-paths listing in read_changes and let reading continue without data loss
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c70-dd1e-7413-aaec-e62ba336f6da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c34-45dc-72b8-b279-1f30d7395e62
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b4a952bc4b
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/changes.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/changes.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/presentation.ts
---
Limit the nobody's overlap-paths listing in read_changes and let reading continue without data loss.

Fix [[d7395e62|the unbounded extra read_changes list]] at the answer's owner: operations/changes.ts returns the full unattributed regardless of limit/cursor, and native-harness/voice/sessionTools.ts prints it whole. An answer at a small limit must stay bounded, report the real total, and offer the regular continuation to every selected line with no gaps or repeats; a plain cut or hidden data in the renderer never fixes the contract. Keep the meaning of Holdings, unknown/unproven and nobody's authorship. Proof is a minimal red→green reproduction through the public operation, sufficient narrow type and consumer checks, one independent review of the whole work, a commit, and an answer to the source reflection. The operator's working server is never restarted.
