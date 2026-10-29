---
id: 01a15134-0b9f-7e2c-809e-ec21adc47829
title: External checks synchronously write and delete the big scratch before the linter runs
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4972-7873-a568-2f09003087d7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/layout.ts
---
External checks' scratch creation, writing, and recursive deletion are moved to programs' native async FileSystem; each destination directory is created once per pass, and every started write finishes before cleanup on cancellation. Ast-grep reads rule directories asynchronously with the same Dirent semantics and strictly decodes YAML bytes as UTF-8. Shared deletion mechanics stay with FileSystem; no separate walker was added. Oxlint, ESLint, ast-grep, and whole-reach are verified on real checker processes: input comes from the judged commit, not the working file; partial layout failure frees the scratch, an unreadable mandatory config fails judgement. Public check_law over all separately passed smoke (1 test, 2 assertions); the standing whole-reach test sits with the public checkHead owner. A point `bun run typecheck` of the whole delivery passed on one snapshot; the last run has no diagnostics of its own, while transitive dependencies met someone else's operation-claims change (35 errors in 10 files). Real latency of the big scratch wasn't measured. One independent review of the whole delivery [[01a15143-2305-7aa1-bd5e-bef8070ec0a7|fs-delivery-review]] finished with no findings.
