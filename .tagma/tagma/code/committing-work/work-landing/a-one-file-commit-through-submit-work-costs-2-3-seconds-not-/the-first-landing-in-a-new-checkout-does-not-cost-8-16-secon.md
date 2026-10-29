---
id: 01a15417-b33a-7058-b932-71f5b33e025f
title: The first landing in a new checkout does not cost 8–16 seconds of preparation
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15419-5393-7adf-9cd9-12864af5de71",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/shaped.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/commitTrees.ts
---
The first landing in a fresh runlith worktree took 17.2 s, of which `prepared.shape` — 8–16 s; later ones ~1.2 s. Find what it is: the hypothesis is the birth of the commit tree's private tree over 29K files. Make the cost proportional to what the landing needs. Proof — a before/after first-landing sample.

**Result (27cc56e017).** Hypothesis confirmed: `read-tree --reset -u` into an empty tree writes all 29,313 files (715 MB) — 6.85 s, 5 s of it CPU; a warm full bring-up is ~1 s CPU, because git stats every file. runlith hooks are only the Tagma gate, which a landing does not run, so the whole tree stood for one `oxfmt` alone. Now steps unpack their files, paths from `run`, and ancestor-directory files; the rest is marked skip-worktree. After review (c6c6d7e566) this happens only when every step declared `reads: "nearby"`; by default the tree is full as before, and there is no retry in the full tree after a refusal. For runlith, declaring `"reads": "nearby"` for `oxfmt` in `tagma.jsonc` can only land after a restart of the working server: the old build rejects the unknown field, and every landing would refuse `commit-step-failed`.

Re-sample after review (same scenario, load 21–34): with `nearby` the first bring-up 0.8 / 4.3 s, later 0.37 / 2.4–3.0 s, process CPU 1.9 / 3.3 s; by default (as the old code) the first 24.1 s, later 2.1–2.7 s, CPU 14.8 s.

Sample on runlith via `CommitTrees.within` with direct git (not host), editing `conditions.ts`, `oxfmt` in the tree; machine under load 25–35 on 12 cores, one sample:
- first bring-up: was 9.7 / 15.4 / 36.7 s, now 1.6–2.2 s;
- later: was 1.7–4.4 s, now 0.4–1.3 s;
- process CPU (4 bring-ups and 4 `oxfmt`): was 16.4 s, now 3.0–3.3 s.

`oxfmt` on one file, launched directly, is 45–300 ms under the same load; 0.4 s on the working server is the execution host's road (`ProgramRoad`), not my code. A full landing on the working server was not sampled: the new code does not work there until restart.

Not proven: Windows (junctions and skip-worktree not run there); the cost of moving an existing full tree to sparse (one `rm -rf` of the old tree) not sampled.
