---
id: 01a131c1-64eb-7b2c-abed-216eecbbc553
title: submit_work lands only the addition half of a shell git-mv rename; the staged deletions are unattributed and no later session can land them through submit_work
ord: 56
tags: ["reflection"]
fields:
  {
    "actual": "Original submit_work landed commit 95de3b970d with only the additions (147 A + 2 M) and the agent reported no held changes, while 147 deletions (1,128,417 lines) stayed staged in the index for a day, attributed to \"nobody (written outside the record)\". The later submit_work answered \"nothing to commit — paths named no file this session holds\", so the cleanup needed a raw `git commit` (commit 4f17aab9a3).",
    "command": "Thread capture-records ran `git mv` of 147 record files in bash and then submit_work; a day later, on the operator's order, submit_work(subject=\"Remove the replay records left behind by the move\")",
    "expected": "The original submit_work lands the whole rename — the 147 additions under records/tagma together with the 147 deletions from the old path — or refuses naming the unstaged-by-record half; failing that, a later session naming the path in `paths` can land the unattributed staged deletions."
  }
---
Evidence: `git show --name-status 95de3b970d` = 147 A records/tagma + 2 M probes, zero deletions; before cleanup `git status` showed 147 staged D the old path and read_changes over the old path judged every file "deleted · nobody (written outside the record)". Blob hashes of the old path@HEAD and records/tagma@HEAD were identical for all 147 files, so the deletions were safe. Cost: the operator had to notice 147 staged files in the Git panel and order a manual cleanup; the landing session's "no held changes" report was wrong about the checkout while right about its own held lines.
