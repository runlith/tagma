---
id: 01a17546-5fbe-758a-97aa-b07233ece7f0
title: Re-measurement of an enforced rule fails on commits older than tagma.config.ts and blocks every commit in the checkout
ord: 145
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: rule 083d37f1 could not be re-measured 3 times in a row: escape origin could not be established: 02682199d5 (2026-04-20, \"chore: init agents config\"): the judged version carries no tagma.config.ts, so it declares no inspection modules. Every submit_work and check_rules over the change in this checkout refuses the same way.",
    "command": "submit_work paths [\"apps/tagma/app/src/lib/features/threads/ThisThread.svelte\"] in /opt/workspaces/runlith (also check_rules over the change), right after the server was restarted on build head-20261025T221332585Z",
    "expected": "The opening re-measurement of rule 083d37f1 finds each escape's origin, treating a version with no tagma.config.ts as one where the rule did not exist (the violation is absent there), and the commit lands."
  }
---
Filed from project `runlith`.

`escapeOrigins` in `apps/tagma/server/src/enforcement/remeasure/origin.ts` walks history back from HEAD; `readingAt` calls `checkOf` on each commit's config and turns `isUnrun(check)` into `unproved(...)`. A commit before tagma.config.ts existed cannot carry a crossing of a rule it does not declare, so it is the absent boundary, not an unproved reading. The walk likely starts because this build carries 448efc38e8 (the modules inspection now reads literal globs), which may surface new findings at HEAD outside debt; at the previous build `check_rules over: all` for 083d37f1 at d62c7e46ea reported no violation.