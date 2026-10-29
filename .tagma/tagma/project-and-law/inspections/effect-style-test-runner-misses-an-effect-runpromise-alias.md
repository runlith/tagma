---
id: 01a13fb9-b4f3-7494-b4a3-723969400e97
title: effect-style test-runner misses an Effect.runPromise alias
ord: 42
tags: ["reflection"]
fields:
  {
    "actual": "All 12 FORMS gave HEAD violations 0/unjudged 0 with this alias at merges.stest.ts:11 and many await run(effect); the runner had to be found and removed by reading, by hand.",
    "command": "checkOf(\"effect-style\", {base:\"\",region:[\"apps/tagma/server/src/graph/\"],files:{extensions:[\".ts\"],exclude:[]},forms:FORMS}).read(HEADtree,[\"apps/tagma/server/src/graph/tree/merges.stest.ts\"],[],cache,\"reach\")",
    "expected": "The test-runner shape flags the runner in a test, including const run = Effect.runPromise followed by run(effect) calls."
  }
---
Filed from project `runlith`.
