---
id: 01a18c11-c7b0-7462-a567-687496bd391f
title: A commit landed a new generated file sliced to 2 of its 17,562 lines
ord: 158
tags: ["reflection"]
fields:
  {
    "actual": "snapshot.json was committed as a new file of 2 lines (36 bytes, `\"name\": \"app\",` / `\"app\",`) while the working file held the generator's 17,562 lines (390,921 bytes); the broken blob stood at HEAD for 14 hours",
    "command": "submit_work landing commit 66482318 (refactor!: rename Tagma plugins to TagmaApp) with apps/tagma/server/drizzle/20261029174920_tagma_apps/snapshot.json",
    "expected": "A new file standing whole on disk lands whole, as heavy.json and migration.sql of the same migration did"
  }
---
Filed from project `tagma`.

Found 2026-10-30 when `submit_work` with `paths: ["apps/tagma/server"]` in commit 42728377af picked up the working file as a change nobody held and restored the full snapshot.

Evidence: `git show 66482318 --stat` lists `snapshot.json | 2 +`, `migration.sql | 92 +` and `heavy.json | 1 +`, all new. The working snapshot.json has mtime 2026-10-29 18:49, before the commit (19:43:59), and parses as a whole drizzle snapshot. The two lines that landed are the ones a plugin→app rename would edit.

Checked and refuted at the fold level: a new file whose creation no record holds, with one line replaced by a session, makes `selectFold` refuse `lines-held` naming nobody, not slice (fold.test.ts scenario run 2026-10-30, not kept). So the slice came from another path — the session's record of that landing, its `paths`/`whole` and the commit steps are not recoverable now. A truncated drizzle snapshot breaks the next migration generation that diffs against it.