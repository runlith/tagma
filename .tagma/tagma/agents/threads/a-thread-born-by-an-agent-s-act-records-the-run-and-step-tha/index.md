---
id: 01a0d136-c362-7db2-9eaa-907eddba1d6c
title: A thread born by an agent's act records the run and step that issued it, so one step's births read as one act
ord: 126
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d136-c1a6-7dbb-b477-8dc4f943c3ed
---
**Outcome.** Every thread born by an agent's act records which act that was: the run and the step of that run that issued it. Threads born in one step share the same fact, which the list row carries as `bornOf`. The sidebar uses it in two ways:
- a parent's children spawned together (a review pair) become one chip in the team strip ([[6c0d60a2]]);
- roots launched together by one act become one launch-group row ([[a4acd1ed]]).

**Problem.** The thread row records `spawnedByRunId`, the run that spawned a child. It records nothing finer, so a parent's twelve children from three steps read as one flat set. The operator wants the review pair spawned in one step to read as one unit. No fact says which roots were launched together either.

**Holds now.**
- `thread.spawned_by_run_id` is written by `ThreadSpawnTree` (spawn and fork) and by `HarnessBirths`.
- A spawn's request id is its tool call id (`CollaborationTools`).
- The run's step number exists in the run's event record (`stepNumber` in `thread/events.ts`, `ThreadStepObserver`), but not in the spawn's tool context.
- A plan's members are born through the same spawn birth ([[26fd5bb9]]).
- A top-level workflow start opens one thread of its own, under which its members are born ([[d6358adb]]). One workflow run is therefore one root with a team, and not a set of roots.

## Target
- **The kernel's thread row gains `bornOf: { by: string; step: number } | null`**, stored as one nullable JSON column `born_of` beside `spawned_by_run_id`. It is written in the birth unit:
  - **A spawn or fork issued by a model call:** `by` is the issuing run's id, and `step` is the step number that run's loop was in when the call was made. The step reaches the tool context through the tool door, which learns it from the loop that already numbers steps.
  - **A plan member's birth:** `by` is the workflow run id, and `step` is the plan step's index. The members of one parallel plan step are one act.
  - **A root created by an agent's call** (Tagma's `create` asked by a thread, or a workflow start asked by a thread): the asking run and step, when the call carries them.
  - **Anything else:** null. That covers an operator's own create, a foreign CLI's act, and every thread born before this change.
- **The list row gains `bornOf: string | null`**, the opaque key `by:step`. Two rows with the same key were born by one act.
- A future fan-out act ("try ×N") writes its own id into the same field, in `by`.

**Owners.**
- [[3ef6226b]], the spawn tree: the birth writes the fact.
- The kernel's stored thread shape ([[53d0aee9]]): the column and `ThreadMetadataRow`.
- The loop ([[d45ec974]]): it hands the step number to the tool context.
- [[edd4a99c]]: the list row's key, and the root-birth acts in `ThreadActs` and `Workflows`.

**Rejected.**
- **Grouping by `spawnedByRunId` alone.** One run spawns across many steps, so a whole team would collapse into one chip.
- **Grouping by birth time.** Clocks are no identity, and two steps a second apart would merge.
- **A workflow run id as the roots' launch key**, which the page suggested. One workflow run opens one root today, so that key groups nothing.

**Acceptance.**
- An agent that spawns two reviewers in one step and a builder in the next produces two distinct `bornOf` keys: one shared by the reviewers, one on the builder.
- A plan step with 5 parallel members gives all five one key.
- A thread born before the change reads `bornOf` null.
- An operator's create reads null.

**Claims touched.**
- [[ac058ca1]] survives: a replay answers the standing child, whose fact was written once.
- [[b3828ba4]] survives, because the fact is born in the same unit.
- The builder writes a claim over the column and the birth. That claim, and the key's claim on the row, close this decision.

**Order.** [[37a0a3ab]]. It depends on nothing. [[6baeb699]] and [[c50f5fd3]] wait on it.

- **10. Contract:** a new nullable field on the kernel's thread row and storage port, which every storage adapter answers (the in-memory adapter and Tagma's). The list row adds an optional field, and older readers ignore it.
- **11. Stored data:** one migration adds `born_of`, nullable with no default. Old rows read null and are never backfilled, because the step of a past spawn is not recoverable from the row. Rollback drops the column, and nothing else reads it.
- **12. Who may do what:** out. The fact is written by the birth, never by a caller, and grants nothing.
- **13. Long-lived things:** out.
- **14. Bounded resources:** out, because it is one small value per thread.
- **15. Rollout:** threads born after the deploy carry it. A team mixing old and new children shows each old child as its own chip.
- **16. Failures:** a birth that rolls back leaves no fact. A replayed spawn keeps the first birth's fact ([[ac058ca1]]).
- **17. Observability:** `read_thread` or the list row shows `bornOf` on a freshly spawned pair.

## Divergences in the build ([[37a0a3ab]])
- **A plan member's `step` is its dispatch's ordinal among the run's step records**, not the plan step's index. A retried or re-entered plan step is then another act, where the index would merge its attempts into one.
- **Agent-asked roots are plumbing only.** `ThreadActs.create` and `Workflows.start` take and write a `bornOf`, but no call carries one: an agent reaches both only from its shell, whose grant names a thread alone. Such roots read null until [[1463d04c]] lands.
- **The kernel's serialized thread wire carries `bornOf` as an optional key**, like the list row. It was required at first (49450e43a7), and a client built on the new schema then refused every snapshot from a server without the change. c08a1123a0 made it optional.
- **An approved call runs under the step that asked it.** The door that executes an answered question opens at the asking step, so a spawn the reader confirmed records its own act rather than step 0.
