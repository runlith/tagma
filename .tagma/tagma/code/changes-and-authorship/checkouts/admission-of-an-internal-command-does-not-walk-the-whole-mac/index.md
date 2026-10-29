---
id: 01a10284-da13-7e0c-9742-a42ce2b5d7e7
title: Admission of an internal command does not walk the whole machine root registry
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe20d57b33b5",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/admitted.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/targets.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/registry.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/store/rootRegistry.ts
---
**What.** Starting an internal command does not walk the whole registry of machine roots.

**Why (perf audit 2026-10-03).** `executions/commands/admitted.ts:127-165` calls `TerminalTargets.resolve` (`executions/terminals/targets.ts:52-78`) anew on every `start`, and `workspace/roots/registry.ts:142-185,238-269` (`resolveFootprint`) pages through all active roots of the namespace, taking realpath/stat and ancestor identities for each, then rechecks path and revision. Cost is O(all machine roots + their ancestors) per git act of submit_work and per bash baseline.

Measured (instance 57f3a082, 15:24:18Z): `prepared.prepare e45979a264194461` — 11.06 s; its `submit-changed ShadowGit.run` — 7.61 s, of which `admittedCommand.start` 7.55 s, `TerminalTargets.resolve` 6.96 s, `FileRoots.resolveFootprint 2e2ebe1e9be6e7b7` 6.93 s — all before git ran. Item 4 of closed [[c6e8bea1]] (admission reuse) does not hold in code.

**Direction.** The roots owner resolves only overlap candidates through a maintained index of physical identities and ancestry; execution holds the admission of one agreed command scope and rechecks only the revisions of its own roots. The symlink and renamed-root guarantees stay.

**Boundary.** The external ancestor-rename contract with a symlink left at the old location (`registry.itest.ts:153`) keeps a stored ancestor index from proving completeness without a reliable filesystem change journal. So the full registry walk stays. What gets cheaper is the walk itself and how often it repeats. The 6.93 s measurement was taken during a series of Myers stalls in the change record, so the walk's own cost was not measured.

**Done when.** One act (all git commands of one submit_work, the baseline of one bash) resolves admission once, then rechecks only its own roots and changed registrations through an indexed changesSince. Someone else's registration does not interrupt the act; a new overlap, retirement, or relocate of its root refuses. The full walk is one registry read and O(K) syscalls with no DB pages and no Effect overhead per root; its cost on K roots is measured in isolation. Overlap, symlink, and rename refusals stay, and the external-rename test is not weakened.
