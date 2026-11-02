---
id: 01a19a05-92bd-7b68-b1a9-520ce91dac8b
title: "nativeBindings: formatting command landing now refuses derive-required over nobody's inputs it once landed"
ord: 9
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a199e3-b937-77b6-8aa6-49967d67ce4b
  - kind: relates
    to: 01a14c85-f889-71f2-8933-7d04992e408f
---
`apps/tagma/server/src/composition/testing/landing/nativeBindings.itest.ts` › "native submit_work keeps command formatting attributed and refuses a required nobody replacement before slicing it" fails at its first landing. It expects `submitted: { status: 'landed', committed: ['src/middleware/timeout/index.test.ts'] }`, but `submit_work` answers `derive-required`: the formatted file is program-origin content landing beside the excluded working changes `node_modules/.bin/vp` and `src/middleware/timeout/index.test.ts.formed`, both held by nobody, which the fixture wrote before the command.

The failure does not come from commit 02dc59ddf7/5428eaf906 (command measurement across checkouts). With that work's behaviour switched back — no reach, no respelling, the old snapshot root and the old moves root — the test fails the same way. The most likely cause is 7f5f6b6fd (fix(commit-steps): derive outputs over the commit tree, 2026-11-01): the scenario predates it (f0f255e30, 2026-10-28) and the file was not touched since 2026-10-30.

To decide: either the derivation check must not count the command's own untouched inputs (a script file it ran, a source it copied from) as excluded working changes, or the scenario's expectation is stale under the new contract and is corrected to the refusal or given a `derive` entry.