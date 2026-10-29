---
id: 01a0d62c-eb12-784a-9b09-8a797f7c73f6
title: "Three execution-host integration tests fail on their own: two managed-shell timeouts that no longer read as timeouts, and a share lowered on an idle host"
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d938-d039-716c-b37e-a67643ed7005",
    "status": "done"
  }
---
Failing alone and in full runs since at least 2026-09-24, under the old preload as under `test/layers.ts`:
- `packages/execution-host/src/managedShell.itest.ts`: "bash over a managed execution host > a command that timed out and then exited zero is answered as a timeout, not a success" and "bash over the ordinary platform world > a generic catalog runs commands and times them out with no host in sight": the answer no longer contains "exceeding";
- `packages/execution-host/src/grantReclaim.itest.ts`: "a share lowered on an idle host > gives history back within one pass, and ends nothing": expected a `ScreenFrame`, got another frame.

Find whether the product or the test moved, and fix the owner. Done when both files pass and their entries leave `test/failing.json`.