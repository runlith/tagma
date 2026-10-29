---
id: 01a15234-508f-7e44-8737-462cf3712409
title: Closing a question picks the next standalone approval in the same waiting-slot entry
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1520d-d830-738b-b878-20699c5f7df9
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: packages/agent/src/thread/run/pendingSlot.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.ts
  - kind: file
    ref: packages/agent/src/thread/run/RoutedTransition.ts
---
The attention slot shows one question, while the standalone-approval queue lives in the journal: losing the first slot must not hide the rest. Replacement selection goes under the same write-unit that closes the current question, and excludes the entry being closed, which reads still see as open. A parked question temporarily occupies the slot, a routed one keeps its queue, and hosted questions do not rise into the native slot; once the primary question clears, visibility returns to the standalone approvals. Among open approvals the slot holds the one waiting for the operator, and an approval with an agent approver yields to it — at placement, at rerouting, and at replacement selection. "Attention" reads only the slot, so otherwise a thread where a second question waits for the operator would vanish from it behind a first one addressed to the parent.
