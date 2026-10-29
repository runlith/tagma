---
id: 01a14a0b-b9b7-7001-9d70-a67d8be2fd86
title: Import writes cookies in batches and counts the rejected against the re-read store, because Network.setCookies refuses the whole batch
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/cookies.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/cookies.ts
---
`Network.setCookies` with one cookie Chromium rejects over shape (e.g. `;` in the name) answers `Invalid cookie fields` and writes not one cookie of the batch; a cookie its store rejects by its own check (`SameSite=None` without `Secure`) it silently accepts and never stores (Chrome for Testing 151 and Electron 44.8.0, one sample). So a refused batch halves down to a single cookie, and the written and rejected counts come from `Network.getAllCookies` after the write — not from the answers: otherwise one bad cookie would lose two hundred neighbors, and silently dropped ones would count as written.

Before replacing, the cookies of the domains the plan covers are removed. A broken write — a command refusal or an interrupted import — removes everything the plan covers and writes the snapshot back: in the same session while it lives, and in a new one only once the session is gone. A new session while the old one lives is impossible on desktop: `webContents` has one debugger, and a second `attach` refuses. Rejected singles do not count as rolled back: the rest of the cookies stay written.

Imports into one profile run one at a time (`Profiles.exclusive`): one import's snapshot, replace, and rollback interleaved with someone else's would delete cookies another import wrote and bring back a stale snapshot.
