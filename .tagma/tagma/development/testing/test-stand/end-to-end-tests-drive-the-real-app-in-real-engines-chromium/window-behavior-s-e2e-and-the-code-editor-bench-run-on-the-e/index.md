---
id: 01a18353-fb48-7e61-8169-3cc1dbba5234
title: window-behavior's e2e and the code-editor bench run on the e2e stack, and the Playwright Test runner leaves the workspace
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1838c-e11a-782f-8555-f3562d02761c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18353-4910-704e-8b7d-d7f17111dc21
sources:
  - kind: dir
    ref: packages/code-editor/stand
  - kind: dir
    ref: packages/window-behavior/e2e
---
Part 6 of [[7111dc21]]: one browser mechanism. `packages/window-behavior/e2e` moves from the Playwright Test runner to `*.e2e.ts` under testbed with its Electron fixture; `packages/code-editor/stand/bench.ts` becomes a stand on the shared fixtures with its quiet-window measurement kept; `@playwright/test` leaves the catalog and the lockfile. Window-behavior's e2e shows windows by design (its examples create visible windows and call reveal), so its runs are headed live checks: they run in CI and on the operator's word, not as an agent's routine test run.