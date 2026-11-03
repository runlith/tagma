---
id: 01a14c85-f889-71f2-8933-7d04992e408f
title: Derived outputs are regenerated in the commit tree when a landing leaves working changes out
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/deriving.ts
  - kind: file
    ref: apps/tagma/server/src/commit-steps/deriving.ts
---
A derived output is regenerated in the commit tree only when the landing leaves other working changes out. `derivationOf` looks for such changes — files git reports as modified or untracked that the landing does not carry; when there are none, the commit already holds every input and nothing is regenerated. Otherwise the `derive` entries of the caller and of `tagma.config.ts` that match the tree's files run over the commit tree, after the format steps.

Only declared output paths enter the commit; outputs equal to HEAD disappear from its diff, and the working output bytes and their recorded writers stay unchanged. A missing, failed or cut run refuses publication (`derive-missing`, `derive-failed`, `derive-cut`). No evidence of a file's origin is kept: derived content no declaration covers lands as it stands, like any whole file, and a command's rewrite of a generated file needs no special selection. A project that wants its generated files regenerated when only part of the tree lands declares the command in `tagma.config.ts` or passes `derive`.
