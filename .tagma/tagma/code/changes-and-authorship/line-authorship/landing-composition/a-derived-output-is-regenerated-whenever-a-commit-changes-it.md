---
id: 01a1b2d7-a737-7cbf-8298-55859ee8cc87
title: A derived output is regenerated whenever a commit changes its declared inputs, and reaches its working file
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a14c85-f889-71f2-8933-7d04992e408f
sources:
  - kind: file
    ref: apps/tagma/server/src/commit-steps/deriving.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/deriving.ts
---
A `derive` entry runs today only when a landing leaves working changes out, on the assumption that a commit carrying every change already holds a current output. That assumption fails whenever an author changes an input and forgets the generator: the stale output lands. In this repository the plugin SDK's generated files (`packages/tagma/src/plugin/*.generated.*`, from `packages/tagma/kit/generated.ts`) landed stale five times on 2026-11-06, each caught only by `kit/generated.itest.ts` after the push; declaring the entry as it stands would add the generator's ~8 s to almost every commit of a shared checkout and still miss full commits. The same holds for any user's codegen (protobuf, GraphQL, ORM clients).

Outcome: a `derive` entry may declare `from` — globs of its inputs. It runs over the commit tree whenever the commit changes a path matching `from` (besides the left-out case), so its cost stays with commits that touch its inputs. When an input-triggered run changes an output and the working output still stands as the base had it, the working file takes the new output, so no stale working copy can land in a later commit. Then the repository's `tagma.config.ts` declares the SDK entry with its inputs. Covered by a submit_work test through the real door, the rules skill and explanation 992e408f.