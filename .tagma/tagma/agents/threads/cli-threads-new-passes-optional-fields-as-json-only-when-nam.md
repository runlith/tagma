---
id: 01a12c8c-30e3-79fd-be4e-310365aeb27c
title: CLI threads new passes optional fields as JSON only when named
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c8b-1b76-72c8-9478-43e6405b51ee
---
Fix the CLI new payload in threads/cli/threadVerbs.ts: valueless type, host and scopeName fields are dropped at the JSON boundary. Verified: threads new with no optional flags created an idle thread on its own tagma:try (port 18531). The general typecheck after the fix stopped on another session's change-record/operations/changes.ts:179, TS2345: string passed instead of branded RootId; reported no errors in the CLI.
