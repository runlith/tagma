---
id: 01a17b0e-4f20-7955-b073-783005608671
title: "First git cut, 2026-10-27: 48 ls-tree in Holdings replaced with raw-tree reads without new processes"
ord: 58
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
---
Attribution 2026-10-27 on Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.4. Continues the earlier inventory: the merged `enforcement.placeOf` and the passed `ConfigVersion.commonDir` already stood on the current code; this work claims neither cut for itself.

## Method and measurement boundary

Three server files, each a separate testbed command with `--no-isolate --parallel=1`: `landing/submitEqualLines.itest.ts`, `enforcement/remeasure.itest.ts`, `change-record/threadAuthorship.itest.ts`. Each file built its own world; the test count and code in these three files never changed. Preload recorded argv, cwd, verb, the `Effect.fn` chain, the root span, and the git process CPU from its runtime handle. Long-lived cat-file sessions still alive at afterAll have no final CPU in this attribution; that is unread cost, not zero. File and children totals come from testbed.

Adjacent A2 B1 A3 B2 runs: A — the original `headsAt` body, B — the intermediate; B3 separately confirms the total after review fixes; switching by exact edits of its own file only, no stash/reset, no copy of the repo. The shared checkout and HEAD nearby moved under other sessions. The machine was under other agents' load: observed load average swung roughly 15 to 68, A2 waited 240 s on slots. Equal-load conditions were not reached: total CPU is reported as an observation, no speedup figure can be derived from it. Processes are compared by producer, because watcher loops moved the other sites even with no code change.

Tools and raw JSONL: `~/.tagma-dev/scratch/01a17ad9-64cb-7877-b99c-2baf36b8a082/`: `git-sites-cpu.ts`, `sites.ts`, `measure.sh`, catalogs `A1`, `A2`, `B1`, `A3`, `B2`, `B3`. A1 is the initial attribution without CPU by site. Before it ran an invalid attempt: preload could not write its file into a catalog not yet created; all bodies passed, afterAll failed ENOENT, and that run is excluded from the comparison. Artifacts live while the thread lives.

## Ranking before the changes

A2: 1221 git in three files. Largest sites by process count and measured CPU:

| Producer | Git | Git CPU |
|---|---:|---:|
| `Holdings.probe` → status | 101 | 558 ms |
| `conversionsOf` → check-attr | 76 | 322 ms |
| `conversionsOf` → core.autocrlf, three judgement and retirement contexts together | 76 | 294 ms |
| `headsAt` → ls-tree | 48 | 240 ms |
| Two topology reads in graph open, for-each-ref together | 64 | 312 ms |

The 48 ls-tree split as 28 landing, 3 enforcement, 17 change-record. `read_enforcement` and the snapshot already read HEAD, commonDir, and the shelf with one rev-parse; comparing against those three earlier commands would not have been this work's result.

## Cut

`headsAt` resolves only named paths through the existing raw reader of tree objects in `@runlith/git`, using the live sessions and a byte-bounded object cache by store and oid. No consumer cache of its own; the earlier memo by revision sides is kept. Reading no longer walks the whole HEAD on a wide batch. Gitlink keeps mode 160000 and its oid: `treePathsAt` has an explicit mode for metadata, while the earlier file/blob consumers keep excluding gitlink by default. An unread raw path and an unsupported spelling take the earlier ls-tree path, so its unread causes and batch fallback stay.

At the same time the authorship base defect was fixed: ls-tree saw the tree's replace object, while the later content reader worked with raw oids. Base and its contents now stand under one no-replace contract. Regression through the public Holdings judgement: a `one\n → one\ntwo\n` write with a replace HEAD tree earlier reported `{added: 2, removed: 1}` instead of `{added: 1, removed: 0}`; before the fix the test failed on that difference, after it passed and named the added line's sole holder. The reader contract is updated in the existing explanation, and the git kit's entry is opened to the change-record module; the module map remeasure found no new crossings.

| File | A2: all git | B1 | A3 | B2 | B3, total | ls-tree from headsAt, A → B |
|---|---:|---:|---:|---:|---:|---:|
| landing/submitEqualLines | 796 | 811 | 796 | 765 | 784 | 28 → 0 |
| enforcement/remeasure | 145 | 143 | 146 | 142 | 143 | 3 → 0 |
| change-record/threadAuthorship | 280 | 272 | 280 | 263 | 263 | 17 → 0 |
| Total | 1221 | 1226 | 1222 | 1170 | 1190 | 48 → 0 |

Total cat-file sessions — 27 in A2, B1, A3, B2, and the final B3: the change did not replace 48 ls-tree with 48 other processes born. B2 still holds 13 ls-tree from a separate file-authorship read, not from Holdings. The intermediate A3 → B2 total is −52 processes, the final A2 → B3 −31. The by-site cut is the same 48 processes in every B; the other sites' difference comes from background reads. B1 shows why the total alone never proves the cut: with the same 48 ls-tree removed, all-git counts grew on extra status, watcher, and topology reads.

Observed file CPU, with children, in seconds (A2 / B1 / A3 / B2): landing 18.4 / 23.2 / 21.3 / 12.7; enforcement 6.1 / 9.5 / 4.7 / 4.7; change-record 4.4 / 6.8 / 3.5 / 4.4. The removed ls-tree cost 240 ms CPU in A2 and 243 ms in A3. Extra work inside live raw sessions is not split out by request CPU; the exact total CPU gain stays unconfirmed. In final B3 the file CPU is 16.0 / 5.7 / 4.4 s, observed load around 8–9.

## Left in place

Status and attribute/config are fresh inputs of every judgement; `.gitattributes`, the index, and user config can change between judgement, build, and retirement. A snapshot across those phases would change the answer. Conversions inside one judgement batch are already read in a batch and passed into preparation, full input read, and blob read. Other conversions reads stand under other holdings: `prepared.build` (8), `Retirer.history` → `introduced` (17), `headBlob` authorship reads (11).

RuleSnapshot repeats in selection, measurement, and standingOver/traceEscapes are split by inspection and new graph contexts: those are stale checks, not repeats of the unchanged. Double topology reads stay under their holdings too. A published commit is never substituted for a fresh retirement HEAD.

The separate ls-tree and the following HEAD read in authorship are not cut: today they carry different replace semantics and different read moments, and the blob-only API loses symlink mode. Passing HeadSide through without aligning that contract would change behavior, not cut cleanly. An independent chain study confirmed these limits.

## Verification and delivery

The single independent review, gpt-6.1-sol xhigh, found two P2s, both confirmed with full chains and public Holdings red→green regressions: a lost cwd prefix of a registered subdirectory and a stripped U+FEFF at a name's start. Fixes at the producer: `oid:./` is resolved by git in the same cat-file session and never cached by request string; the decoder keeps BOM as a name character. Moves, symlinks, and refusal of raw reads are never replaced with a path assumption. No second review ran.

On the final code, seeds 1, 2, 3 each passed separately: git `treePaths.itest.ts`, `working.itest.ts`, `objects.itest.ts`; server `holdings.itest.ts`, `threadAuthorship.itest.ts`, `submitEqualLines.itest.ts`, `remeasure.itest.ts` — 7 files, 21 separate runs. The git kit typecheck is green. The server typecheck was green before the review fixes; the rerun on the final code found no diagnostics in the changed git paths but ended red on a parallel wait-contract migration by another holder: `commandEndings.itest.ts(606,13): 'waitMs' does not exist in type 'CommandOutputRequest'`, plus old `wait_command`, `wait_call`, `take`, `settled` in its tests. The holder confirmed the migration belongs to them and is moving the tests over.

Full server integration twice stopped the host at the 10-minute life: with check:change it recorded 392 file rows / 1973 bodies, without check:change 298 / 1470. Neither ledger carries outcome/file-verdict rows: neither a pass count nor the absence of reds is established by them. There is no full green integration verdict; partial attempts do not sum into a full pass. The first `--resume` attempt failed ENOENT because the runner never created the final report; the defect went to the test:all owner. After the new no-slicing law, no piecemeal continuations were run.

`check:change --paths-from` over the first four own paths was also stopped by life. App jobs over 87 files, agent-tools over 4, execution-host over 2, and git over 1 and 3 files finished green; server jobs gave no full result. After review a fifth path `objects.ts` was added; wide verification of the final change stays unconfirmed. The test set was never narrowed for the process count; server and browser were never started by hand.

The first cut landed with commit `2336030628`. The task continues: the next producers and a full green integration are not done yet.
