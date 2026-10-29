---
id: 01a14a2f-6aca-7808-b237-b961a6b168ce
title: "Split managed-browser/host.ts by subject: 650-line rule debt"
ord: 6
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a149c8-375a-7feb-a9de-77eda565e03a
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
`managed-browser/host.ts` grew past 650 lines without imports: 668 of them. The file mixes several subjects:
- the Chromium process life per profile and idle exit (ensure, sweep, exit);
- the tab registry and parsing of page and browser CDP events (bind, onPage, onBrowser);
- navigation with commit waiting;
- the `Host` port implementation (open, adopt, close, live, pdf, answer, paint, session and the profile session).

Start from where the boundaries run. Done when each subject stands in its own module file and this file's debt is cleared.
