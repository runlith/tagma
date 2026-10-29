---
id: 01a16e1d-d386-74b8-85eb-1eb7e79786bf
title: "Product git per operation reads once: graph open, project birth, checkout row, caller checkout, MergeChecks, and config site"
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dec-fbf8-7898-a8a7-e83233ac9f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16c8d-16cd-71b0-bf80-15dfafa44677
---
Cut git processes per operation at the producer: facts read once per operation, `rev-parse` questions merged into one call, what is read passed along instead of reread. Git behavior and refusals stay the same. Goals and the before measurement — [[afa44677]]: `GraphPool.open` (~28 git plus ~10 for `FreshnessGate.refresh`, `syncTopology` twice), project birth (31 git), `CheckoutStatus.reading`, `Repo.readCallerCheckout` (one `rev-parse` per HTTP request with `cwd`), `MergeChecks`, and `Configs.storeFile` per rule. Before and after measured with the git-site preload on the same scenarios.

Total 2026-10-24 (git-site preload, one run per file): `landing/place.itest.ts` 1091 → 964 git, `http/collaborationDoor.itest.ts` 76 → 68, `graph/serving/projects.itest.ts` 62 → 62.
- A rule remeasure costs 3 git instead of 7: one snapshot `rev-parse` reads HEAD, the shared git catalog, and the measurement shelf, and `Configs.read` takes the cache site from the version (9476b906f4).
- `repositoryAt` reads locations and HEAD with one `rev-parse` (090837e17a).
- The HTTP caller's checkout reads lazily (a71d7c227b).
- The first topology replay after graph open reads instead of resyncing (798782d0c7).
- A new tree attach does not reread the worktree list (d622e2cdb1).

Not cut: the second `config --list` in `MergeChecks.fingerprint` — an immutability witness, not a repeat. The Holdings judge is the x-landing work. The config cache site in the landing judgement and commit steps can be passed by the landing itself.
