---
id: 01a117dd-98e5-7df2-86cb-e3fc61efb1f6
title: An agent's read-only command got record lines on files another thread was writing with typed tools at the same time
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11682-7259-7579-a690-e43ccbbf5004",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a117dd-98e5-7df2-86cb-e3f13b5e7d6f
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commands.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/lives.ts
---
A read-only research `ux-research` (agent `code`, thread 01a117ba-e91e-7c67-859d-305fc39408ed, run 01a117ba-e938-7ae4-a31a-adc63db41e29) ran only `rg` and reads in this checkout on 2026-10-07, but the change journal recorded its `write` lines in three files another thread, s4-judge (thread 01a11742-4faf-72c4-808d-229c880821a9), was writing with typed tools at the same time:
- `apps/tagma/server/src/change-record/holdings/judges.ts` — lines 11–189;
- `apps/tagma/server/src/change-record/serving.ts` — 46–186;
- `apps/tagma/server/src/change-record/holdings/judge.ts` — 469–475.

s4-judge has its own lines on the same paths (`judges.ts` 11–263, 20–253, 44–196). So one shift is recorded twice: s4-judge's typed write and the researcher command's window. Under [[b17adfeb]] a command's shift never goes to it when a tool line explains it (the `instant` mark registers before the file write).

**Start with:** `read_changes path:` on the three files; the researcher command windows' journal (`record/journal.ts`, `commandRows.ts`) and the `record/lives.ts` decision for these paths; whether the `code`-agent command window passes the same journal and sees the `tagma` threads' `instant` marks.

**Done when:** a read-only command's window, while another thread writes the file with a typed tool, gets no record lines on that file — an integration test on two threads; the found cause is fixed at the owner.
