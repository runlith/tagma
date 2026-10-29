---
id: 01a17b3f-430a-70d3-8dd9-0be08b6ffb44
title: "Graph publication git cut, 2026-10-27: GitPlaces passed from operation check to CAS/index, 10 processes removed"
ord: 61
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
  - kind: discovered-from
    to: 01a17b31-1c07-7a93-afb1-badfa98fbd02
---
One graph-batch publication attempt drops a repeated `GitPlaces` read. `publishToCheckout` reads the layout at the earlier first point where `openOperation` read it, separately verifies the `operationIn` liveness, and passes the same paths in the mandatory `Publication.places`. `platform.git.publish` no longer reads the layout after `commit-tree` and witness: it is already there for `advance` and `settleIndex`. No other product callers of `publish` remain; its public contract test moved along with the consumer. The layout's meaning and lifetime boundary are refined in the [[064d4461|layout explanation]].

HEAD, branch, and operation are never passed as a snapshot. `advance` still reads `operationIn`, then `pointedAt`, and `update-ref` publishes with the earlier expected oid. Settlement keeps the ref/HEAD check, index lock, and staged state. Clean deltas and held answers take the earlier branches; the first `placesOf` refusal keeps its op and text. The next publication attempt, plus a separate index-debt repayment, reads a new layout; it never lives in the committer. No consumer cache, throttle, or debounce.

## Measurement

Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.4. `graph/tree/commits.itest.ts`, seed 1, one live testbed command each with `--no-isolate --parallel=1`. A1 B1 A2 B2 — adjacent runs; in A the original two production files restored with exact edits, in B the cut returned. `git diff --exit-code` before A2 confirmed the original source. This test file never changed for the counter or otherwise in the cut: all eight of its bodies are the same.

| Site / measure | A1 | B1 | A2 | B2 |
|---|---:|---:|---:|---:|
| All git | 245 | 235 | 245 | 235 |
| All `Git.layout` | 27 | 17 | 27 | 17 |
| `platform.git.publish → Git.layout` | 10 | 0 | 10 | 0 |
| CPU of those repeated reads, ms | 36.346 | 0 | 70.812 | 0 |
| CPU of all layout reads, ms | 98.244 | 102.975 | 193.584 | 144.812 |
| CPU of all git, ms | 1168.747 | 2093.703 | 2437.954 | 2715.001 |
| Run CPU with children, s, `run` row | 3.474 | 6.102 | 6.968 | 8.411 |

Exactly 10 processes removed in each B (−4.1% of the file's git); the initial reads and standalone settlement passes stayed. Others' commands raised load: observed readings of the first runs moved from about 18 to 37 load average. Total CPU gain is therefore not established, though the removed reads' cost is measured: the run's CPU grew in B. Every git of these four samples gave CPU in preload; JS/SQL cost is not derived from one git process's sum.

Raw argv, cwd, Effect frames/root, and CPU, plus saved testbed JSONL: `~/.tagma-dev/scratch/01a17b0f-3179-7b33-b757-80acce88f8f3/places-A1`, `places-B1`, `places-A2`, `places-B2`; the analyzer `layout-sites.ts` beside them. No stash/reset or checkout copy between A and B.

## Graph opening

The earlier `GraphPool.open Git.locations×2` readings are not confirmed as two reads of one checkout on the current code: in the `topology-B2` attribution the two `Git.locations` belong to two open code checkouts, one each. The watcher asks `rev-parse --is-bare-repository --show-prefix --path-format=absolute --git-common-dir --git-dir --show-toplevel` in the code checkout; `identifyMirror` asks commonDir with HEAD in the shadow tree; the first freshness pass asks prefix/top/own in the shadow tree. These are different queries and, for the watcher, a different repository. They were not substituted for each other in this cut; HEAD and topology were never carried over.

## Verification

Seeds 1/2/3 each passed separately for `platform/git/publish.itest.ts` (7 bodies) and `graph/tree/commits.itest.ts` (8): 6 file runs / 45 bodies. The new public publication contract creates MERGE_HEAD in the witness after Publication is prepared and verifies MidOperation with HEAD, index, and marker unchanged; existing scenarios verify HEAD shift, branch change at the same commit, a lost update-ref answer, index lock, a staged file, and index-debt repayment. `git diff --check` over the three paths green.

Package `bun run typecheck` read the changed paths with no diagnostics but gave no green over the unfinished parallel terminal-endpoint migration by another holder: `TerminalThread.ts(275,332)` — missing `input/endpoint/next`, `wireCorpus.test.ts(201)` — no corpus of version 41 and an implicit any. The holder confirmed the cause and keeps moving it over. The earlier run saw only the intermediate `commandNotice.itest.ts:472 Cannot find name wakeCompleted`; that holder already fixed it. This is no typecheck pass of this delivery. Full integration and check:change never ran on the launching agent's limit; server and browser never started.

The independent [[01a17b3b-faff-7d7e-8b9f-4f9a4b64e4ff|publication reviewer]] on gpt-6.1-sol xhigh found no findings: it read the whole chain, refusal/CAS/settlement, consumers, and raw ABAB with file-verdict pass and residue 0. It started nothing itself. Commit `aaea892d89` carries this cut's three paths; no own uncommitted lines remain.
