---
id: 01a15171-25ca-7c79-aa0b-100dde05d48c
title: A program ledger replacement scope is set by the confirmed coverage of its read
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/group.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/ledger.ts
---
A program may answer with a full reach even to a changed-paths request: such an answer replaces its whole ledger, not just the requested files. Coverage is stored under the inspection-key prefix that starts the program's fingerprints, so a full read doesn't extinguish debt it never checked. The explicit coverage list is completed with removed or no-longer-source requested paths: the server confirmed their absence before running the program. An explicitly covered base path is a complete read even when its file did not change: an empty finding set there defeats stale debt when a dependency makes the path a new violation.
