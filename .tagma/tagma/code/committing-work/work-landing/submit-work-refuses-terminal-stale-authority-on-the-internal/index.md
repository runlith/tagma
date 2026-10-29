---
id: 01a12a17-3049-7dba-9498-66939a90905a
title: submit_work refuses terminal-stale-authority on the internal git rev-parse, and the same call passes on retry
ord: 54
tags: ["reflection"]
fields:
  {
    "actual": "refused — nothing was committed: git rev-parse ended and its console could not be read: terminal-stale-authority: The authority or policy bound at preparation changed before admission; the same call passes unchanged at once. Twice in one session, one extra call each",
    "command": "submit_work({ paths: [...], whole: true, subject }) in the tagma-holder-impl-f0e304 worktree while 6 sessions work in it",
    "expected": "The landing follows a fresh read or refuses with a contract whose cause the caller can change"
  }
---
Both commands are the landing's own internal `git -C <worktree> rev-parse --verify -q HEAD`, not the session's command. The caller has nothing to “re-read”: unblock offers repeating the act, so the door itself could have repeated the preparation on fresh authority. The server-swap session (01a129b5-c758-767a-8771-4d71aff7160), 2026-10-11 ~07:28 and ~08:33 UTC.
