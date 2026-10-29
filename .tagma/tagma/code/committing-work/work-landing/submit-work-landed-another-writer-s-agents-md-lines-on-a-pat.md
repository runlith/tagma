---
id: 01a15b30-1df1-7503-8b2d-9394b63be4a7
title: submit_work landed another writer's AGENTS.md lines on a path whose own lines the record had marked cleared
ord: 109
tags: ["reflection"]
fields:
  {
    "actual": "Commit 04f5b94aa3 carried AGENTS.md with two hunks this session never wrote (the \"Before delivery\" and read_zone lines, written by another process/session 9bc19e19) and without this session's own edit.",
    "command": "submit_work {checkout: \"/opt/workspaces/runlith\", subject: \"Serve one orientation …\"} (no paths, no whole)",
    "expected": "AGENTS.md stays out of the commit: read_changes listed it as `cleared` for this session (its one-line edit had been overwritten by another writer), so the session held no lines there."
  }
---
Filed from project `runlith`.

read_changes just before landing: `run 01a15b11-2e4d-… · AGENTS.md · cleared`; AGENTS.md was absent from the session's held-paths section. `git diff --stat -- AGENTS.md` showed 2 changed lines, none this session's (its removal of "MUST read graph_overview…" had been overwritten — the line was back). The landing still listed AGENTS.md among its 43 paths and committed those two hunks under this session's subject. The hunks match the running server's current managed law section, so no wrong text landed, but the attribution is wrong and the change record of the real writer lost its uncommitted lines into a foreign commit.