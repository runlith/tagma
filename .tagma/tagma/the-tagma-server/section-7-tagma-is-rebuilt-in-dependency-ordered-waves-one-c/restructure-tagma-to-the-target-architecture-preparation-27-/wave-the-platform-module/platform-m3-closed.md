---
id: 01a0e532-c849-7240-8737-0456cfbcbd60
title: "platform M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e533-8064-7d5a-81fb-ef815c9f98b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c83e-75dc-a3c4-533ae1411479
  - kind: waits-on
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
---
§7.2.2 milestone `M3` of the `platform` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

**Closing note.** M3 is delivered as the §3 substrate that landing and graph E2 call: the git kit in `platform/git/` (hook lane 280, commit lane 290, compare-and-set `publish`, `receipt`, `index.settle` 300), `packages/held`, `platform/contract/service/capacity.ts` and `deadlines.ts`, beside the K0 contracts, branded migration chains and reporting-first write sets. The first runs of the four builtins (`answer-declared`, `operations-registered`, `held-resources`, `blocking-calls`) and the debt they record belong to builtin-modules' task. `WriteSetMode` stays `'report'`; the blockers for `'refuse'` stand on merge list [[4a9013bf]]: the D9/E8 mixed-load measurement of `FULL` + `fullfsync`, the 8 bare-string write sites, raw `Store.db` writes outside units, cross-store unit nesting, and statements against `ATTACH`ed snapshot copies. Divergences are the deltas this task implements.