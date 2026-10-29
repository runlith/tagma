---
id: 01a0d873-292e-7899-84ef-8defb7092dd4
title: "Build: test layers as rules — `at: 'work'` with `inspect_work { layers }`, program rules in the re-measure driver, a queued merge's caller, a warm materialized tree, runlith's layers enforced"
ord: 147
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d872-b04f-7518-9666-04ecbf490b13",
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0d559-16ad-72c3-b569-eb528e7c936b
---
Build the engine sections of [[8e7c936b]] ("Engine sections (from the architecture thread)") on top of command inspections ([[50467aad]], area [[805446cf]]). Complex.

Order:
1. `at: 'work'` beside `landing` and `merge`, additive under `version: 1`. `inspect_work { layers: [<rule>] }` runs those rules over what the change reaches, in the caller's own checkout (no materialization), answers the verdict and records nothing.
2. The re-measure driver runs program rules too, off every permit, under the landing session's authority: a rule at watch after landing records new failures and violations in `escaped`, raises `rule-escaped` and tells the author's thread. `escaped[].line` becomes optional, and old documents still decode. Wired in the same change ([[a00f91b0]]).
3. A queued merge stores its caller (a migration on the pending-merge record; old rows read as today), so a program rule at merge runs under it ([[5408b1c0]]).
4. Materialized-tree cost: one warm materialized tree per checkout, moved to the judged tree by a checkout of the tree-ish rather than a fresh clone, keeping its installed dependencies and re-running the project's setup only when the lockfile changed; bounded (one per checkout, removed when idle for long, released on project retirement). Measured before and after.
5. runlith's test layers enforced as rules whose program is `bun scripts/testLayer.ts` (`format: tagma`, `needs: files`): unit at `work` plus watch after landing; integration watch after landing (or merge); system at merge. `test/failing.json` absorbed as each rule's first debt and deleted in the same change; the runner, `test/*`, bunfig and package scripts belong to the tests thread, which makes the runner change. `enforce_rule` calls are handed to the operator's agent.

Out: idea [[2b4bf576]] (where a program's own code is read from).

Done when: each item holds in fixture itests within [[adb6798b]]; claims under [[805446cf]] written from the code and verified; divergences filed as deltas; one Opus reviewer ([[6ccec00a]]); the tree-cost figures named.
