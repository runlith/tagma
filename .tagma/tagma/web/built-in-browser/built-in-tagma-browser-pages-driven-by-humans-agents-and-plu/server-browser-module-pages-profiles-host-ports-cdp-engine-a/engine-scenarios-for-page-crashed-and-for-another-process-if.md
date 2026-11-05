---
id: 01a14a77-03be-73fe-bc58-71acf8781c35
title: Engine scenarios for `page-crashed` and for another-process iframe request response bodies
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18444-f9dd-7094-9360-03bfeb88fb40",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1484a-2e3b-77ca-b058-0914c4428b2f
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/testing/scenarios.ts
---
Two engine behaviours are not covered by the shared scenarios (`browser/testing/scenarios.ts`, run on managed and desktop):
- **`page-crashed`.** A crashed renderer sets `crashed` in the live state, and actions refuse with `page-crashed`, except reload, which brings the page back. Trigger the crash a way both hosts have (for example `chrome://crash` or `Page.crash` through the host's test access), and check the action refusal and the return after reload.
- **OOPIF response body.** Requests are keyed by frame target, and the body reads in that frame's session (`Automation.body`). Check that `read_page_network` with `body` for another-origin iframe request returns its body, and answers `body-unavailable` once the frame is gone.
