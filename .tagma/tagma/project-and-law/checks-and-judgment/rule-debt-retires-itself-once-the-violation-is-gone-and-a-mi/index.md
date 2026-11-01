---
id: 01a14c14-a11c-7ce8-9d84-63387548cc1d
title: Rule debt retires itself once the violation is gone, and a missed violation is reported to whoever let it through
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633958074d0c
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/driver.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/memory.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/origin.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/settlements.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/debt.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/held.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/measurements.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/past.ts
---
**Value.** Existing violations don't hang as a dead list: their removal is visible right after landing, and everyone who let a violation past the gate learns about it and answers for it.

**How.** Automatic: the driver receives landings and HEAD movement of open copies. At server start it takes the main checkouts of enforcing projects and the journal's landings; it remeasures other copies when they open. This remeasure is triggered by the open event regardless of the background startup walk. After `enforce_rule`, the calling copy and the main checkout are remeasured; closing a copy removes the HEAD watcher, disappearance of the root removes it from the driver's memory. Debt owners are tasks and specs.

**Behaviour.**
- A remeasure retires vanished debt and records or retires escapes; it adds no new debt records — debt grows only through `enforce_rule` or `set_module`. HEAD movement during an already running pass keeps a follow-up pass regardless of comparison with the previous checkpoint; the result of a different HEAD or a changed declaration is not confirmed.
- A remeasure belongs to its open copy: closing it cancels running and pending runs, frees the lane, and keeps unprocessed landings in the journal.
- Landings waiting for a remeasure are journaled and replayed after a restart. `submit_work`, `merge_worktree`, and `check_rules` over a change wait until the initial remeasure of their open copy records every rule's debt: debt retired by someone else's commit does not excuse a new violation with the same fingerprint. The origin of new escapes is looked up after that write, in its own driver lane: the landing court does not read escapes, so one rule's lookup holds neither another rule's remeasure nor the landing, and its failure is reported and retried as a remeasure failure. An escape with a proven holder is recorded and reported to them together with the debt. Other acts do not wait for this remeasure; HEAD movement of an idle copy is accounted for at its opening against the last confirmed measurement.
- An escape whose holder is a thread is reported to that thread: where the violation stands and what will retire it. The holder comes from proven authorship of the landing; someone else's HEAD movement alone makes nobody a holder. Later authorship up to a confirmed measurement only completes a continuously standing escape with the same origin SHA: it does not assign a violation that had vanished by that measurement and reappeared.
- A violation that so far stands only in a session's uncommitted change can be taken into debt in advance: such debt is held against the change, becomes ordinary after landing, and vanishes if the file changed without the violation or was deleted from the working checkout before the first landing. A warm start verifies retained debt given unchanged HEADs and inspection digests.
- Measurement observation is stored in each checkout's git directory, so branches don't conflict over measurement time and SHA. A new escape without a proven landing commit gets the SHA of the fingerprint's first appearance above debt between the last confirmed measurement and HEAD; historical versions are judged against their own config, so a tightened check may be the cause; a version without `tagma.config.ts` or without the rule key carries no violation, and the lookup does not read versions without a config. If the check itself changed since the confirmed measurement — Tagma inspection code, rule reach, the module map, or debt — a violation the changed check already finds on that measurement's version is recorded on it with `changed: check`: the check change let it through, and old versions are not measured with today's code. After a reset or rebase that removed the old boundary, the lookup walks reachable history; unreadable history or inspection leaves the origin unproven: no escape is recorded, the remeasure reports a failure instead of an invented SHA, and the debt it recorded stands. The same holds for a version read by the lookup where the inspection left an unjudged spot able to hide a violation: any spot for `loads` and programs, the violation file's spot for file-local builtins, and none for `modules`, whose unverified loads never become findings.

**Limits.** HEAD movement selects rules by paths changed since their last confirmed measurement and by declaration change. File-local and program checks receive the path delta; programs that declare delta remeasurement in their confirmed reading also receive the still-readable comparison version and a measurement mode that retains all current findings. Other programs keep a one-sided measurement. The ledger is replaced by the answer's coverage separately for each binding. Without a source measurement, exact debt sources, or under a joint binding with a global builtin, a full pass is needed. Origin history is parsed by the existing inspection worker; the server receives bounded portions, so DAG size never becomes synchronous work on its event loop. Debt whose owner is finished or replaced shows as needing a new owner but is not reassigned automatically.
