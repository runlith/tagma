---
id: 01a16c8d-16cd-71b0-bf80-15dfafa44677
title: "Product git inventory in the server's resource tests: producers, commands per operation, repeats, and cuts (2026-10-24)"
ord: 1
---
Which product git runs in the server's resource tests, how many per operation, and with which commands — measured 2026-10-24 on one machine (Apple M2 Max). Process counts barely depend on load but do depend on timing: poll loops in tests (`Effect.repeat` with a 20 ms pause) and watcher events spread runs of one file — e.g. `landing/place.stest.ts` at 1259, 1152, and 1138 processes across three pre-change runs. So "before/after" below compares call sites, not just totals.

## Method

- Raw testbed reports after the test speedup (`~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/after/`): server itest + stest — 78,443 git processes over 878 files. 128 files with ≥200 processes carry 48,773 (62%); the median is 28 per file, mostly world build and project birth.
- Attribution: preload `~/.tagma-dev/scratch/01a16c60-ca29-7e6f-8b62-6b2bf867736d/gitsites.ts` intercepts `child_process.spawn`/`Bun.spawn` and writes argv, verb, the `References.CurrentStackFrame` chain of the current fiber (each `Effect.fn` call site), and the root span for every git. Analysis — `site.ts`, `deep.ts`, `repeats.ts`, `diffsites.ts` in the same place; raw jsonl in `before/` (pre-change), `after1/`–`after3/` (intermediate), and `final/` (final code) subcatalogs.
- Files, one per command, `--parallel=1`: `WorktreeFinishing.stest`, `http/graphlessDoor.stest`, `landing/steps.stest`, `landing/place.stest`, `enforcement/ownGit.stest`, `change-record/commandLanding.stest`, `http/graphFormat.stest`, `threads/parityRequests.stest`, `change-record/threadAuthorship.itest`, `workspace/checkouts/rows.itest` (core set, 7595 processes before changes); for graph, http, and threads additionally `graph/idleCopies.stest`, `graph/serving/folder.stest`, `graph/serving/vocabularyFormat.stest`, `graph/serving/lanes.stest`, `threads/rolloutDrill.stest`, `http/doorParity.stest`.

## Verbs (core set before changes, 7595)

`rev-parse` 1625 (40%), `config -z` 277, `diff` 264, `status` 232, `worktree list` 172, `diff-files` 160, `for-each-ref` 112, `merge-base` 103, `commit` 99, `diff-tree` 97, `log` 76, `ls-tree` 74, `add` 70, `ls-files` 67, `cat-file blob` 62, `init` 57, `config --path` 55, `check-attr` 46, `config --get` 44, `merge-tree` 39. The extended set raises HEAD `ls-tree` of the Holdings judgement, `check-attr`, and `config --get` almost to `status` level.

## Producers by operation

| Operation | git per instance | Composition |
|---|---:|---|
| `Holdings.judge` — authorship judgement batch | 4.4 | `status` by paths, HEAD `ls-tree` by paths (`headsAt`), `check-attr` and `config --get core.autocrlf` (`conversionsAt`), sometimes `check-ignore`; before the cut another `rev-parse --git-dir` to open the judge |
| `CheckoutStatus.reading` — checkout row (`CheckoutRows.readTree`) | 4.6 | `status`, `rev-parse --git-dir` for the sequencer, `diff --cached --numstat`, `diff-files --numstat`, `config -z` (publishRemote); base comparison — `rev-parse` + `merge-base`/`diff` |
| `FreshnessGate.refresh` — graph-tree freshness | 5.7 | `status` (before the cut + `rev-parse --git-dir`), `config --path core.excludesFile`, `worktree list`, `for-each-ref` ×3; when due — rereading the same refs in `syncTopology` |
| `GraphPool.open` — graph birth/open | ~28 + refresh ~10 | shadow: `init`, `mktree`, `commit-tree`, `update-ref`; `syncTopology` twice (attach and after fill): `for-each-ref` ×2, `worktree list` ×2 per repository, `rev-parse -q --verify MERGE_HEAD`, `rev-parse --abbrev-ref HEAD`; `Git.locations` ×2; watcher: `config --path`, `ls-files --ignored`, `check-ignore`; project-identification `rev-parse` |
| `submitWork` — landing | ~30 | landing tree (`read-tree`, `update-index`, `write-tree`, `diff-index`), hooks, publication, index pull-up (`ls-tree`, `ls-files --stage`, `reset`), retirement |
| `read_enforcement` / `enforcement.ruledIn` | 3 | `commitOf` HEAD, `Configs.storeFile` (`rev-parse --git-common-dir`), measurement shelf (`rev-parse --git-path tagma/measured`) |
| `enforcement.remeasureRule` | ~7 | `ruleSnapshot` twice (HEAD + store), `treeOf`, shelf ×2 |
| `Configs.read` | 1 | only the cache site's `rev-parse`; config files go through a standing `cat-file --batch` session |
| `MergeChecks.fingerprint` | 4 | `rev-parse` of the shared and own git catalogs as separate processes, `config --list`, `config --get-regexp include` |
| `mergeTreeApart` | ~6 | site `rev-parse`s, driver `config`s, `merge-base`, `diff-tree` ×2, `merge-tree` |
| `Repositories.read` | 2 | `storeAt` and `headAt` of one shared catalog |
| HTTP door, every request with `cwd` | 1 | `rev-parse --show-prefix --show-toplevel --git-common-dir` (`Repo.readCallerCheckout`) upfront, before the operation |

## Repeats inside one operation instance

875 of 7595 processes (11.5%) are an exact repeat of the same command under the same root span. Largest: `Configs.storeFile` 80 (one per rule in a remeasure pass), HEAD-watching `commitOf` 66 (long-lived root, repeats in time are legitimate), remeasure `headOf` 51, `config -z` in `MergeChecks` 44 (fingerprint re-verification), `check-ignore` in `eligible` 43, layout `placesOf` 29 (known from 064d4461). `GraphPool.open` repeats the two `syncTopology` reads, `FreshnessGate.refresh` repeats `readTopology` and the `syncTopology` after it: check-then-act under different holdings, not cut.

## This work's cuts

Count by call site, core set "before → after" on the final code (`before/` → `final/`).

1. `statusAt` no longer reads the sequencer: only the checkout row shows it, and it asks `sequencerAt` itself, inside the same `statusMs` measurement the `slowStatus` measurement depends on. The Holdings judge stopped resolving `--git-dir`, which only that needed. `rev-parse --git-dir` at status 262 → 161 (the rest are checkout rows), the judge's `rev-parse --git-dir` 122 → 0.
2. The checkout row runs `diff --numstat` only for the area where `status` named writes: weights read only for those writes. `diff --cached --numstat` 160 → 26, `diff-files --numstat` 160 → 31.
3. `MergeChecks.fingerprint` reads the shared and own git catalog with one `rev-parse` (`pathsAt` in kit; on failure or an unparsable answer — the earlier separate reads, so the refusal is the same): 80 → 40.
4. `ShadowGit.mergeInProgress` does not ask `rev-parse -q --verify MERGE_HEAD` when the tree's git catalog has no MERGE_HEAD file; in every other state it asks git. The tree's `.git` pointer is now read the way git reads it (everything after `gitdir: `, no trailing CR/LF), parsed once for `treeBranch`, this check, and `attach`: the earlier parse cut the path at a newline. 46 → 8; on six graph files 88 → 17.
5. `Repositories.read` reads store and HEAD with one `rev-parse` (`storeHeadAt`; on failure — the earlier `storeAt`, then HEAD with the earlier `headAt`): 192 → 120.

Commits: cuts 1–2 — 1ba3b7adf7, cut 4 with the pointer parse — a80eb741bd, cuts 3 and 5 — 846f0b6d11.

Core-set total: 7595 → 6967 (−8.3%). Six graph, http, and thread files where cuts 1–2 already stood before the measurement: 2198 → 2122 with cuts 3–5.

Skipping `rev-parse --abbrev-ref HEAD` in `syncTopology` by the tree's HEAD file (about 109 more over 16 files) was dropped after review: a readable HEAD never proves git will accept a tree with damaged worktree metadata, and in the attach path no other git command in the tree makes that act, so the refusal would have moved.

Review gpt-6.1-sol xhigh found two defects (the `slowStatus` measurement, the pointer parse with newline) and two risks (that skip, kit fallback tests); all accepted and fixed, the pointer-failure test failed on the earlier parse. Two more own `.git` pointer parses with the same newline cut stand in `workspace/roots/coverage.ts` and `worktrees/relocation.ts`; module cards forbid merging them into one kit door, outside this work.

## Next candidates, not cut here

- HEAD `ls-tree` in the Holdings judgement batch (largest remaining site, ~4% of the set): the commit tree is immutable by oid, and the kit's standing `cat-file --batch` session already caches objects. Limits: `ls-tree` pathspec is relative to cwd (checkout root with prefix), a catalog path expands recursively, and git's error text enters the `unread` cause.
- `read_enforcement` and remeasure: HEAD, config cache site, and measurement shelf read with one `rev-parse` per act, if `ConfigVersion` carries the store site from the caller (the config ↔ enforcement boundary).
- The HTTP door reads the caller checkout on every request with `cwd`, even when the operation never asks for the site; lazy reading moves the refusal moment.
- Double topology reads in graph open and refresh are deliberate rereads under holding; they cut only by passing the read inside one holding.
