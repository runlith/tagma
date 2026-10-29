---
id: 01a0f773-3a18-7b10-945e-4ce843b10f11
title: Prove now-phase enforcement acceptance through owner contracts
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0f476-052f-72dc-811f-f2468fe9d0a8
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/adoptionFiles.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/oxlintAccepted.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/enforcement/runnerAdoption.itest.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/checkers/identity.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/checkers/prepared.itest.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/group.test.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/oxlint.itest.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/testing/packages.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/testing/wiring.ts
  - kind: file
    ref: checks/law/install.ts
  - kind: file
    ref: packages/git/src/entries.ts
---
Prove the grouping, trusted checker execution, suppression, predecessor-law, counts and value criteria of [[8fe9d0a8]] §7 against existing enforcement tests; add only missing owner-contract cases and fix evidenced defects. Compare one-file runlith judgement stage timings and work counters as a machine sample. Scope: enforcement programs/checkers and composition/testing/enforcement. Contract tests and root-wide checker fixes landed in commit 84a5ff9237dddc05dc7c1f1e53af27174abd66e5; focused tests and server/Git typechecks pass, and independent Sol review found no defects. [[17dc2043]] carries the new whole-tree Git contract. Remaining: a sanctioned before/after measurement of the migrated one-file runlith landing. Two equal-HEAD passes of the existing eight unadopted gates measured one path, eight inspections and zero violations, with stage totals 7.4 s then 5.0 s; this is a cold/warm sample, not proof of migration cost. Adoption and server restart were outside this task's authority.