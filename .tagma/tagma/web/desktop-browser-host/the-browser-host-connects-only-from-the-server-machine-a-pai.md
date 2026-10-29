---
id: 01a1489c-3f98-769a-a1f4-5cef8a6fa311
title: "The browser host connects only from the server machine: a paired device gets neither the command tape nor the report stream"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/desktop-browser/door.ts
  - kind: symbol
    ref: apps/tagma/server/src/invocation/admission/admit.ts
    symbol: admitFeed
---
The host executes CDP in the operator's browser profiles — with their logins, cookies and passwords — and tells the server what happens on the pages. A paired device acts as the operator, but a host on it would mean someone else's machine posing as the Tagma window: taking agents' commands to the operator's pages or forging their reports. So the tape is declared `local`, and tape admission refuses a caller with a `deviceId` with `device-refused`; the report route refuses with the same code before the socket upgrade. The desktop host lives in the app process on the server machine and never reaches those refusals.
