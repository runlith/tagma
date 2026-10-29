---
id: 01a0dbf2-1f4b-77ee-9d89-db450f13462b
title: "Changes panel lists files as uncommitted after their bytes landed: a stopped run's held rows never settle"
ord: 125
tags: ["reflection"]
fields:
  {
    "actual": "The Changes panel lists commands.ts and terminals.ts as Uncommitted; read_changes shows a held write at line 7 by session 01a0db82 (run 01a0dbac-57d7, a stopped run), while git shows both files identical to HEAD and submit_work answers nothing-to-commit.",
    "command": "Git tab «Uncommitted» after submit_work landed; read_changes apps/tagma/server/src/protocol/operations/commands.ts",
    "expected": "A path whose working bytes equal HEAD (git hash-object == HEAD blob, git status clean) is not listed as uncommitted and holds no session's lines."
  }
---
Filed from project `runlith`.

Measured 2026-09-26 at HEAD 94ebf39141: blob 11f9b030 on both sides for commands.ts, 1f7af68e for terminals.ts. The run that wrote them was stopped by the operator mid-command (the 15-minute hang of reflection 84694b75); its held rows are never reconciled against the landed commits, so the operator sees phantom uncommitted files.