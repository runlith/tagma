---
id: 01a1524d-76ee-71a1-98be-7405624608d8
title: Open questions of an unloaded thread read without decoding the whole closed history
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-567a-72f4-83ce-3134e2c0b824",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1520d-d830-738b-b878-20699c5f7df9
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/fold.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/restedFolds.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/restedWork.ts
---
In the cold-rollout branch `ThreadStore.openQuestionsOfRun` is served by `RestedFolds.questionsOfRun`: it finds every question record for the runId in the transcribed file through `scanned`, then `stillOpen` drops the closed ones. For `approvals:<threadId>` that is the accumulated history of standalone approvals. Time and volume of a specific unloaded base were never measured; linear reading follows from the code. The SQL path already uses a live index and suffix candidates, while the cold file has no such addressable index. Give the rested-transcript owner an addressable read of open questions with compatible restore of the old file; never filter a whole history in the consumer. Proof: public openQuestionsOfRun over an unloaded thread returns only current questions, keeps their order, and never decodes closed question bodies; check reopening the old format.
