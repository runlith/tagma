---
id: 01a19132-28f5-7e42-ac8d-5d32d29d6435
title: submit_work landed a new migration without its first line and named nothing left out, breaking HEAD
ord: 165
tags: ["reflection"]
fields:
  {
    "actual": "Commit d26618bb19 landed migration.sql without its first line, `ALTER TABLE native_thread_rev ADD change_rev …`, which the triggers in the same file write. The working file kept the line as uncommitted. The answer listed the path as landed and named no line left out. HEAD then created triggers over a missing column, so a fresh database fails every write to ten thread tables. The bench caught it through read_changes, which attributes the line to nobody \"after overlapping command windows\". Landing it again with `whole` fixed it (9489558a0).",
    "command": "submit_work { subject: \"feat(agent): order thread projection changes by a durable change revision\", paths: [..., \"apps/tagma/server/drizzle/20261031084927_change_revision\", ...], tasks: [\"a3cb3d23\"] }",
    "expected": "A new, untracked migration file named in `paths` lands whole, the way the session wrote it. Any line left out is named in the answer (`left`, or the lines it attributes to nobody), so the session can carry it with `whole`."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

How the file was made: `bun run db:generate --name change_revision` (drizzle-kit, a command) created migration.sql with the two ALTER lines. The session then overwrote the whole file with `write` (fromFile), giving the same two lines followed by 29 CREATE TRIGGER statements. Line 2 (`ADD change_open`) landed while line 1 (`ADD change_rev`) did not, although both came from the same command and the same write. A generator-made file the session then rewrites with a file tool should land whole, or at least the answer must name the dropped line.