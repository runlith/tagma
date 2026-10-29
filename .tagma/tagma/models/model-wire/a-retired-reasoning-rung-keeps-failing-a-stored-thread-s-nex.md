---
id: 01a0c978-2bb7-7b23-aa39-ffa1e06c92b0
title: A retired reasoning rung keeps failing a stored thread's next call, and the asymmetry with the switch drop is the recorded intent
ord: 57
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-047a-7956-b3dc-cdbda058a6e5
---
Decided on the operator's word, 2026-09-22: the reasoning rung KEEPS refusing. The switch drop and the rung refusal are not an inconsistency — they answer different questions.

The reasoning rung travels to the provider options, so a stale one changes what the model is asked to do, and the refusal names the level and the model, which makes it actionable. A switch id the row does not declare is read by no shipped lowering — every profile reads the known ids by equality — so dropping it changed nothing on any wire and refusing it only bricked the thread. That asymmetry was the reason to drop one and not the other, and it is now the recorded intent rather than an accident.

What stands as measured in case it is revisited: Tagma stores `settings.reasoning` unchecked (`AccountDefaults.ts:296-314`), `namedSelection` checks provider and model only (`models/catalog.ts:227-230`), so a caller-fresh typo'd rung is stored and then fails every call; and the reach is real across openai's two ladders (`models/openai.ts:38-39`, `'max'` in one only). No write door refuses it today — the only rung gate is at harness birth (`apps/tagma/server/src/harness/chosenModel.ts:46-51`).

Nothing to implement. This block closes on a decision, not on work.