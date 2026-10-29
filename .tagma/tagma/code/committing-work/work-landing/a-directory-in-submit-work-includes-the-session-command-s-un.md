---
id: 01a12d44-4edf-76bf-9d1c-14f99ef0708c
title: A directory in submit_work includes the session command's unattributed paths
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12d44-1fa7-7e71-ab8b-b1945f56e247",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c9c-4ed2-71c5-b358-8e0587d5028d
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/carriers.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/change-record/commandLanding.stest.ts
  - kind: file
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
  - kind: file
    ref: packages/agent-tools/src/bash/answers.ts
---
Fix the paths selection at the change-record owner: a directory with `whole` includes unattributed changed paths the calling session's command touched, on the same terms as an exact file name. Prove the commit contract and the bash-notification agreement; run a Sol xhigh review and a Muse lens, land the change. Do not touch the operator's server; checks no longer than 3 minutes and at most 3 parallel processes, typecheck only bun run typecheck.

The cause is two different predicates in heldPaths: held paths selected by nesting, retained unattributed paths — by exact equality. One existing `within` now serves both selections; checkout and carriers limits kept. The bash directive and the paths description admit a file or a containing directory. The [[4c940a20|selection explanation]] updated by the operator's decision; the historic exact-file behavior in the [[0f274db0|footer delivery]] separated from this decision.

The contract proved red→green through public command windows and submit_work: src/generated.ts carries no line of its holder, stays as an overlap observation, enters HEAD by paths:["src/"] and whole:true; src-other.ts stays out of the commit. The old behavior returned status:nothing with unmatched:["src/"]. Full suite — 6 pass, 25 assertions. Collected command→record→landing checks moved from .itest.ts to .stest.ts after 9344 ms CPU against the 8000 integration limit; the final system run took 6.55 s wall, within 60 s. Diff checked for whitespace, unrelated changes, and secrets.

bun run typecheck checked 4448 files and exited with one error outside the delivery: apps/tagma/server/src/composition/testing/place.stest.ts(73,40) TS18046: 'first.body' is of type 'unknown'. read_changes attributed changed lines to graph-branches; no errors in changed source files and the new test. Full typecheck stays ungreen. The operator's server untouched.

One independent review round: Sol xhigh found no defects; three Muse xhigh remarks checked along the producer chain and needed no change. Command paths come from git status -z and ls-files --full-name (CheckoutBaselines.checkoutState/untrackedWithin), and ShellRun.movesOf and recovery keep these names: the proposed normalization of both sides at the consumer does not fix the observed defect. An empty paths element already meant the root in existing within; a new refusal on an assumed typo would change the old contract. Checkout and carriers guards unchanged and verified by reading the whole chain; separate runtime directory-with-taking and other-checkout scenarios not run. The required inclusion contract for an unattributed file and exclusion of a lookalike prefix proved red→green.

The change landed in 6c156df4c3 through submit_work. Commit steps formatted the test and the bash directive; final files re-read, changes shape-only. read_changes confirmed no held paths of this session.
