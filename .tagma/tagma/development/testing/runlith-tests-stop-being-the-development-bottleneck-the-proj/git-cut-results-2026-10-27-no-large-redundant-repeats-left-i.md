---
id: 01a17b49-5d33-70cb-a588-f30b4b8aa2d0
title: "Git cut results, 2026-10-27: no large redundant repeats left in the hot paths"
ord: 65
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
---
After the product's earlier git inventory, the hot paths under test hold no large redundant repeats: the remaining status, attribute/config, and topology reads take fresh inputs or are split by a write and different holdings. New micro-optimizations stopped on the operator's word; unlanded cuts of the config-key and merge-attempt layout reads are withdrawn.

Landed:

| Commit | Result at the call site |
|---|---|
| `2336030628` | Holdings base and its blobs read under one raw/no-replace semantic. 48 ls-tree removed across three files (28 landing, 3 enforcement, 17 change-record), cat-file session count still 27. The replace-object base swap, registered-subdirectory cwd prefix, and U+FEFF at a name's start fixed and proven red→green. |
| `5d4ec2424a` | In one scoped refresh, the repeat verification of an already resolved commit removed: freshnessMatrix 147→146 git, one duplicate verification →0. Moving HEAD/stamp, CAS, and holding boundaries kept. |
| `aaea892d89` | Graph publication passes the already-read layout along. This cut made history before the order to stop: commits.itest 245→235 git, repeat Git.layout under publish 10→0; history kept as landed. |

No whole-CPU gain is proven: load and watcher passes differed. The removed 48 ls-tree cost 240–243 ms CPU in A; the duplicate refresh — about 8–10 ms; the publication's 10 layout requests — 36–71 ms. These prices do not sum into a whole-suite speedup percentage.

Full conditions and A/B stand in the [[05608671|Holdings measurement]], the [[724531d7|refresh measurement]], and the [[8b6ffb44|publication measurement]]. The verified limits of the remaining status/conversions reads are in the [[f58e536f|study of the leftover reads]]. Landed cuts passed separate contract files on seeds 1/2/3 with independent review; confirmed findings fixed. No own or child uncommitted lines remain after the stop.

A separate full server integration on 8 workers: 511.50 s wall, 2145.34 s CPU, 3443 tests, 757 file-verdicts (747 pass, 10 routine Docker skips), no failures, no residue. The world-background thread's `integration-n8-pair.json` report is read; the earlier 377.16 s was a red run and proves no speedup. Code, worker budget, and load differ, so the result is not credited to the git cuts. Worker budget and the main run's tail are studied separately; these data do not argue for continuing git micro-optimizations.
