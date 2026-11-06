---
id: 01a14c85-f889-71f2-8933-7d04992e408f
title: Derived outputs are regenerated in the commit tree when a commit changes their declared inputs or leaves working changes out
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/deriving.ts
  - kind: file
    ref: apps/tagma/server/src/commit-steps/deriving.ts
---
An entry that declares `from` — its inputs — runs over the commit tree whenever the commit changes a path those globs match, and only then: a commit carrying every change still regenerates its output, so an author who forgot the generator cannot land a stale one, and a commit that touches no input pays nothing for it. Its new output reaches the working file through the same delivery as a format step's delta, where it merges cleanly, so the stale working copy cannot reach a later commit — unless a working change left out of the commit touches its inputs, in which case the working output answers to those working inputs and stays. An output the base did not hold is taken as an entry without `from` takes it.

An entry without `from` runs only when the landing leaves other working changes out. `derivationOf` looks for such changes — files git reports as modified or untracked that the landing does not carry; when there are none, the commit already holds every input and nothing is regenerated. Otherwise the matching `derive` entries of the caller and of `tagma.config.ts` run over the commit tree, after the format steps, and the working output bytes and their recorded writers stay unchanged.

Only declared output paths enter the commit; outputs equal to HEAD disappear from its diff. A missing, failed or cut run refuses publication (`derive-missing`, `derive-failed`, `derive-cut`). No evidence of a file's origin is kept: derived content no declaration covers lands as it stands, like any whole file, and a command's rewrite of a generated file needs no special selection. A landing without the formatting commands derives only for left-out changes.