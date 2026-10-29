---
id: 01a14da4-e478-7f9b-8ce3-74e3621cc688
title: "Learned command-signature roles from repo history: clean runs and writes, READER_RUNS and WRITER_HITS, machine-database table"
ord: 2
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
Step 2 of spec [[46bb0015]] (§2). Stands on the roles task. Proof is the spec's acceptance §3.

## Delivery, commit 4b46000b67

Owner is `change-record/record/lessons.ts`: the `command_signature` table in the machine database, a lesson queue off the command path, `ready` on the next open. `commands.ts#lessonOf` counts the lesson off the window's verdict; `ShellRun.finish` now also verdicts windows with no shifts, otherwise a clean run with not a single shift never taught. Replay after restart does not teach.

Retro run with the rules in code (one sample, main slice at 06:25 UTC; the share depends on the live checkout's mtime, so “list only” also moved against the [[c404f4ca]] numbers): list only — 48.7% of unattributed lines (63.8% of attributable ones), list + learning — 51.4% (67.3%); list entries promoted to writers by learning — 0 (the one previous case, `oxfmt … && tsc`, no longer counts: the line has two writing parts).

Checks: itest `commandLessons.itest.ts` (reader after `READER_RUNS` clean runs, writer after `WRITER_HITS` single writes, a composite line teaches nothing unnamed, lessons survive restart, replay teaches nothing); kit tests for parts without a signature; change-record itest and unit — 158 pass; agent-tools — 167 pass; check_law — clean. Review — lessons-review (claude-opus-5-5 / high); confirmed findings fixed before commit.

Not proven: not checked under load on `tagma:try`; the cost of `ready` on open unmeasured (it only waits for the previous command's unwritten lesson); the table is never cleaned — it grows with the number of signatures across checkouts.
