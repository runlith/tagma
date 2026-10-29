---
id: 01a13fcd-99c0-72f5-b9fa-59e17b82a2cf
title: Migrate external harness birth and the modelChoice tests to Effect
ord: 6
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
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/modelChoice.test.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/sessionBirths.ts
---
The first part of birth/: replace SessionBirthCoordinator with an effectful make, keeping the SessionBirths contract, model/transport choice and refusals; dependencies from existing tags, no new layer for shape's sake. Update the direct assembly and test consumer, migrate the modelChoice tests to effect-test, keep the useful contract checks. InstalledHarnesses and its processes are a separate delivery. Proof: narrow unit tests, one package typecheck, check_law and an independent review; diff to the parent before the commit.

Delivery `601143c139`: production with wiring 663→653 nonempty lines (+33/−43), effect-style of two sources 4→0, tests 6/27, check_law 17/0, three independent reviews with no findings. One package typecheck finished: no errors in the changed files, five external errors handed to owners. hookAdoption.stest.ts verified by compilation and reading, with no host-bundle system test run. The parent accepted the result; the testing/doubles facade stays as the testing entry for one stest.
