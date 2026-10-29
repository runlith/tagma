---
id: 01a11901-470f-7498-99ae-69ecdb527d85
title: "App: ThreadRung — the sole authority over thread life; thread services, ThreadSlot, ThreadBirth instead of HarnessHost"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e4e5e1e307
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e980577970
---
Per [[e5e1e307]] throughout. The `View.svelte.ts` debt leaves.

Done: the tests from [[e5e1e307]]; `read_enforcement` with no `View.svelte.ts` entry.
