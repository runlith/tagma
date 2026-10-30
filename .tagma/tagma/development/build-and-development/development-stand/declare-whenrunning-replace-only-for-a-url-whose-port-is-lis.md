---
id: 01a0c83c-e1d9-7950-b41b-a262364d4495
title: "Declare `whenRunning: 'replace'` only for a URL whose port is listened to by one process that is safe to kill"
ord: 7
tags: ["rule"]
sources:
  - kind: file
    ref: packages/dev-runner/src/index.ts
---
Replacing stops every process listening on the URL's port.