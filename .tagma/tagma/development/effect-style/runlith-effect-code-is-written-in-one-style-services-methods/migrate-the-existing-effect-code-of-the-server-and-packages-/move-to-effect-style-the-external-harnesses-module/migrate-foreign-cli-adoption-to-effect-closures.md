---
id: 01a13fb3-6c43-7241-8f29-67f6903164d7
title: Migrate foreign CLI adoption to Effect closures
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/adoption
---
The `external-harnesses/adoption/` group: replace SessionAdopter with an effectful make with dependencies from tags, keep the job witness proof, refusals, best-effort side effects and the HarnessAdoption.adopt span; clocks and the re-read delay are Clock/Effect. Coherently update the assembly and direct testing consumers, migrate the shellJob tests to effect-test. Proof: narrow tests, group effect-style 0, one package typecheck, check_law and one independent review round; diff to the parent before the commit.
