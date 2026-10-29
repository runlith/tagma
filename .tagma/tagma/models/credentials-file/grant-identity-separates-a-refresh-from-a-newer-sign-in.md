---
id: 01a1881a-fe17-7d7c-80cb-681698415824
title: Grant identity separates a refresh from a newer sign-in
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/credential-file/src/RefreshFlight.ts
---
The caller's grant identity must change when another sign-in replaces the grant, while unrelated metadata must not change it; otherwise an exchange already in flight could overwrite the newer sign-in. A request is prepared inside the flight so one exchange retains the same decoding and validation policy through commit. Without a cross-process lock, callers for the same document and record must share the flight instance. With one, its path must identify the same document and record across processes.