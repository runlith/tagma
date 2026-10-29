---
id: 01a13fa1-8c9a-79ac-8a00-982b3bfd3825
title: submit_work and the command summary credit a read-only command's window with others' parallel edits
ord: 24
tags: ["reflection"]
fields:
  {
    "actual": "submit_work 3e2698f277 answered “7 paths this session's commands changed without attribution” (graphTools.itest.ts, graphFiles.itest.ts, ThreadRunReaper.ts, and others) — these are the edits of port-agent-tests and others made during my typecheck. port-agent-tests got “unattributed by” my window in read_changes and spent a question on me about whose edit it was.",
    "command": "bash: `bun run typecheck` in apps/tagma/server, then submit_work(paths: [my 7 files in packages/agent])",
    "expected": "A command that writes nothing to sources (typecheck, bun test) does not become the author of other sessions' edits; submit_work does not name them “paths this session's commands changed”."
  }
---
Session refl-exec (01a13f64-c076-7697-a126-c82ea82d299c8), 2026-10-15. About 10 agents worked in the shared checkout at the same time. The command summary already says “these observations alone do not prove who wrote a file”, but the submit_work answer phrases them as this session's changes and invites “submit again naming them in paths to land them” — inviting it to land others' lines.
