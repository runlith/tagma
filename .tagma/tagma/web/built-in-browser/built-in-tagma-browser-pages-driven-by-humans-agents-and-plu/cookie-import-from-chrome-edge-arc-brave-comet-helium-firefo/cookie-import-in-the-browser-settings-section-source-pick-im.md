---
id: 01a14a0d-1840-7898-b4b7-1eb72f02174c
title: "Cookie import in the \"Browser\" settings section: source pick, import_cookies launch, result, and refusals"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a11eae10179
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/browser/section
---
The client part of [[eae10179|cookie import]], which neither step 1.3 nor the panel did: in the "Browser" settings section ([[e3064958]]) — the receiving profile, the source from `list_cookie_sources` (a browser and its profile, another Tagma profile, a JSON file), the `import_cookies` launch, the result (`written`, `google`, `unreadable`, `rejected`, `domains`), and the refusal in the server's words with its unblock — including Safari without Full Disk Access.

Done when: the application's `bun run typecheck` is clean, the commit goes through `submit_work`.
