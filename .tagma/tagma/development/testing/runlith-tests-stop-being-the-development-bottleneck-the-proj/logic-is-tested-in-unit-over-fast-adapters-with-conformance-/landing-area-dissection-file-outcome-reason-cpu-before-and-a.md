---
id: 01a17c5f-eaa3-7f56-9963-cc24c4ba0800
title: "Landing area dissection: file, outcome, reason, CPU before and after"
ord: 44
---
Outcome of each itest file in the landing area (`composition/testing/landing/*` and `landing/merge/git.itest.ts`) under this spec. Commits: 0a53c2a2b2, a4b88af291, 297319c722.

**CPU before** is the file's line in the server integration run on 8 workers under load (report `scratch/01a17b03…/integration-n8-pair.json.d`), file CPU seconds with children; **A/B** is the file body, CPU before → after, A B A B pairs, `--parallel=1`, load 2.6–4.5, two rounds agreed; left-alone files not measured.

## No git port built

- Line slicing by holders, dependent lines and carried are pure `foldPath`, `selectFold` and `projectWork` in `change-record/lines`, which already have unit sets.
- The `submitWork` pipeline holds records in SQLite, and SQLite stays real per the spec. So the pipeline test stays itest under any port.
- The remaining files' subject is git semantics itself: index, attributes and filters, hooks, merge, CAS and publication reflog. An in-memory adapter would repeat it as a second git.

## Total

| | before | after |
|---|---:|---:|
| moved files, body (A/B) | 12.35 s | 6.25 s (−49%) |
| git processes per run | 1 296 | 641 (−655, about 6% of the area's 10 542) |

The four moved files no longer need a door world or project birth: in a separate run the world's "cost" drops from 2.8–3.5 s to 0.2 s. In the set the door world is shared per worker, so this part of the saving is smaller.

The area estimate is about 14–17 s of 227 (6–7%). It comes from scaling A/B onto the base run's lines; this is not a measurement.

Also, `checkoutFixture` now stands on a physical path. Before, on macOS (`/var` → `/private/var`) cross-file dependency traversal (`change-record/prepared/dependencyWalk.ts`, `treeAt.realpath`) silently dropped every target on this world. Product roots are physical (`78f606d3`), so only the fixture diverged.

## Files

| File | Outcome | Reason | CPU before, s | A/B, s |
|---|---|---|---:|---|
| `place` | itest | native and HTTP door in a foreign project with its law, tasks, steps and worktree | 24.6 | — |
| `submitEqualLines` | 2 deleted, 1 to unit, 3 to `checkoutFixture` | 1 and 2 covered by `fold.test.ts › an inserted block keeps its closing lines in its own slice while two peers delete equal lines beside it` and `› a surviving block stays whole in every slice when peers delete all blocks before it and append blocks after it`; 6 → `fold.test.ts › a peer whose only line the shortest diff cancels against the carrier's stays out of the carrier's landing`; 3–5 — stitching between landings: landing compositions and the window of departed records. Each of the three turns red on broken stitching (checked in a temporary worktree) | 15.7 | 6.5 → 2.3 |
| `submitGit` | itest | CAS publication with a lost `update-ref` answer and reflog, race with `git commit`, hooks, `index.lock`, argv limit, git failures at every stage | 14.1 | — |
| `submitDeletion` | itest on a door world | intake by the agent's real tools (write, delete, edit) under a stale fsmonitor, and an off-Tagma session on the HTTP door with explicit `paths` | 13.3 | — |
| `steps` | itest | form steps are real programs (`ProgramRoad`) and hooks | 11.5 | — |
| `mergeHome` | itest | merge runs programs from the calling thread in its home: place and door are the subject | 9.8 | — |
| `submitExternal` | itest | session off Tagma on the HTTP door | 7.4 | — |
| `submitBytes` | itest | working-tree attributes, CRLF, non-UTF-8, preparation cancel | 7.4 | — |
| `mergeConclusion` | itest | observed worktree closes a real merge and merges to main | 6.9 | — |
| `carriedTasks` | itest on a door world | task labels carried are collected by the `submit_work` operation over `submitWork` (`landing/operations/submit.ts:79`) | 6.7 | — |
| `submitNobody` | half to unit, half to `checkoutFixture` | "a write moving a repeated line across lines it removed holds every line" → `fold.test.ts › a write whose shortest diff moves a line across lines it removed holds every line of the patch` (extended with a whole-slice check); nobody's announcement and `whole` are stitching with dependency checks. Intake through `createTools` leaves (covered by itests on `commandWorld`) and `read_changes` reads | 6.5 | 1.2 → 0.8 |
| `submitIndex` | itest | index: staged bytes, modes, rename, alignment after landing | 6.5 | — |
| `submitBeside` | itest | landing beside an open merge and its index | 6.3 | — |
| `submit` | itest | path choice, staging, Holdings court; world already narrow | 6.1 | — |
| `hookMessages` | itest | hooks editing the landing and merge message | 6.0 | — |
| `submitMerge` | itest | closing a merge with a merge index and interrupted publication | 5.8 | — |
| `submitBindings` | to `checkoutFixture` | cross-file dependency check is Holdings, import-traversal and binder stitching | 5.8 | 2.0 → 1.6 |
| `mergeHooks` | itest | merge hooks in the base commit tree | 5.8 | — |
| `interleaved` | to `checkoutFixture` | carried command dependent lines beside a working peer is stitching. `read_changes` reads replaced with record lines (`committed` state and commit). This scenario no longer checks warm Holdings between landings or `taking` resolution by id on the door; both stay in `place` and `submitDeletion` | 5.6 | 2.65 → 1.55 |
| `stepsShaping` | itest | names with tabs and newlines, modes, binary data under steps | 5.5 | — |
| `submissionRecord` | itest on a door world | `ThreadChanges` stream, bash command window and lease retirement of the live runtime | 5.3 | — |
| `submitEnds` | itest | `core.autocrlf` and the user's clean filter | 5.1 | — |
| `submitLines` | itest | staging foreign paths, `whole`, taken-session admission; world already narrow | 4.4 | — |
| `submitLarge` | itest | large files and unchanged-lines steps | 4.1 | — |
| `commitLandings` | itest | landing publication to the thread | 3.7 | — |
| `commandMove` | itest | `git mv` and an edit in one command | 3.7 | — |
| `submitMoves` | itest | staged moves | 3.5 | — |
| `submitHoldings` | itest | line outcome after landing, command window | 3.4 | — |
| `selection` | itest | Holdings choice and refusal to mix two checkouts | 3.1 | — |
| `operatorLines` | itest | world already narrow; `taking: operator` resolution, `retire store` and retirement on a real commit | 2.9 | — |
| `submitStopped` | itest | native-call cancel after publication | 2.7 | — |
| `programmatic` | itest | `linguist-generated` attribute and lockfile | 2.4 | — |
| `submitMoving` | itest | branch moves under the court | 1.7 | — |
| `submitPeers` | itest | world already narrow; archived → retired mapping (pure part covered by `fold.test.ts › an ended holder's change rides along whole once a carried region takes any of it, while a live peer's stays on disk`), on-disk Unicode name normalization | 1.5 | — |
| `landing/merge/git.itest.ts` | itest | `MergeGit` conformance on the real adapter | 1.4 | — |
| `stepsFact` | itest | answer about `tagma.config.ts` in HEAD without extra git | 0.4 | — |

## Producer-side candidates (not measured A/B)

One file's git-sites showed about 100 of 760 processes on repeated reads. These are `Git.workingConversions` (`check-attr` and `config --get`) in every Holdings court (`change-record/holdings/inputs.ts:79`) and 69 `GraphPool.open` and freshness processes on the door world. Cutting at the producer would cheapen both the classes that stay integration and the product itself.
