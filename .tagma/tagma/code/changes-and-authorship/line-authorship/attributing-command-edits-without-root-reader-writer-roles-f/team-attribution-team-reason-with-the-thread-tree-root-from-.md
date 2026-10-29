---
id: 01a14da4-e478-7f9b-8ce3-74e40459f2fb
title: "Team attribution: team reason with the thread-tree root from the thread record, landed by the root via a member's taking or via paths"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14d6a-a561-7869-a9fa-49cfe8cacd0e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14d98-e0c1-7622-a276-d30446bb0015
  - kind: waits-on
    to: 01a14da4-e477-7ec2-b31a-eb74c404f4ca
---
Step 3 of spec [[46bb0015]] (§4). Stands on the roles task. Proof is the unit test “two writers, one tree → team” and landing by the root via `taking`.

## Delivery, commit e56e501b5f

The tree root (`spawn_root_id`) is read from `ThreadRecords` when the command opens and kept in the window; `Lives.decider` yields `team` only after set filtering and the “writers beat readers” rule; the observation (`command_unattributed.team`) shows in read_changes, in the Holdings windows and in the `bash` summary. The root with a member's `taking` carries its team path without `paths` only if every observation on the path is that root's `team`; a path with others' lines is skipped without refusal.

Retro (one sample, same slice): 5.7% of lines left unattributed by the list and learning have candidates from one tree — now `team`.

Checks: `lives.test.ts` (different trees and a treeless thread → overlap, one tree → team); `teamLanding.stest.ts` (the root lands via a member's taking, one member and a sibling via taking — no, another's observation on the path — no); `commandJournal.itest.ts` (team survives restart); change-record, landing, sessionTools — 210+ pass, four files timed out under a parallel typecheck load and passed singly. Review — team-review (claude-opus-5-5 / high); confirmed findings fixed before commit.

Not proven: not checked on `tagma:try`; the cost of reading the thread record on every open unmeasured (the whole `facts` row is read; thread-record has no narrow root read); `taking` a running member needs the operator's word, so in practice the root often lands via `paths`; `team` lines of a deleted root's children stay until the children are reaped.
