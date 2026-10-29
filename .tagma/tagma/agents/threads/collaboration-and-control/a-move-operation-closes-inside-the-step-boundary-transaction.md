---
id: 01a17f63-371e-778f-88fb-effd8a7a122c
title: A move operation closes inside the step-boundary transaction, and each of its core requests carries the commit participant
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f1c-bd6b-776b-a00f-dc252a0c2131
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/targets/decide.ts
  - kind: file
    ref: apps/tagma/server/src/threads/targets/preparation.ts
---
Moving a running thread resolves in two acts: the decision writes a `thread_target_operation` row with status `pending`, and the step-boundary commit participant (`TargetPreparation.prepare`) publishes the choice, records the target, and moves the home on a cross-project move. The same participant marks the row `applied` with the generation — in the same transaction. Otherwise only whoever asks the core again while the run lives would know the outcome. A run that ended before the question left the row `pending`, and the next retry answered `failed`, even though the choice and the home had already moved.

Every context-switch request `ThreadTargets` places into the core — decision, `change` retry under the same key, `read` — re-prepares the target and carries a commit participant (`asking`). The core seats the participant of the first accepted request, and a retry of an existing one only reads its outcome. So a participant-less request accepted first would publish the new place's context at the boundary without the choice and the home move. Two requests with a participant are equivalent: both check the choice revision and do the same thing.

A key retry is checked against the recorded assignment — `home_id`, otherwise the deciding project's `project_id` — not against `home` relative to the call's current home. After the move the call stands in the new home, and the same move asked from there matches the record. The assignment's `rootId` does not decide, because one root can stand in several projects (`project_root`).
