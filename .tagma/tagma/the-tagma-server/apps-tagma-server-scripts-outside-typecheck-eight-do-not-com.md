---
id: 01a17971-8420-775d-8b24-f1d4436d2baf
title: "apps/tagma/server/scripts outside typecheck: eight do not compile, and the breakage passes unnoticed"
ord: 156
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1794b-b79a-7bae-b6cc-afa9c50eb203",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/scripts
---
`apps/tagma/server/tsconfig.json` does not include `scripts/`, so `fetch-browser.ts` silently broke when `makeChromeForTesting` started requiring `Background` (fixed in `79681583af`). A trial inclusion of `scripts/**/*.ts` on 2026-10-26 gave 43 errors in eight files: `baselineMirrorProbe`, `bench-history`, `bench-mirror`, `bench-screencast`, `bench-thread-folds`, `bench-turn-ack`, `profile-runtime`, `prove-history-rows`. They import what no longer exists (`fixtureMigrations`, `graphLayer`, `machineGraphLayer`, `baselineMirrors`) and call APIs in old shapes. Fix or delete each script that is no longer needed, then include `scripts/**/*.ts` in the server's typecheck, as in `apps/tagma/desktop`.
