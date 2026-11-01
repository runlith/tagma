---
id: 01a19471-c11f-7184-8092-d9c144a8862f
title: Holdings keeps judged verdicts within a memory budget, without an object per line
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
---
Section F of [[2afe6fec]].

Measured on the live server (instance `1e33b7f0`, 2026-11-01): judge entries shaped `{judged, probe, stable, prepared, digests, rows}` (`Entry` in `change-record/holdings/judge.ts`) held 63 MB in 210 entries 22 minutes after start and 69 MB 18 minutes later.

One verdict kept 143,347 line objects, 33 MB, for a single git-ignored path carrying old record lines. Two more ignored paths kept 47,822 lines each, 10.5 and 7.3 MB. An open judge keeps every judged path's whole verdict for as long as a thread's change stream holds it ([[8175b246]]), and with twenty agents streams hold judges continuously.

What stands when done:
- a verdict's lines are held compactly, or not at all once what reads them is projected;
- the judge declares a memory bound and evicts past it;
- a large ignored file with record lines costs bounded memory.

Done when the judge's memory for a path no longer grows with its line count beyond the bound, and Holdings' existing contracts stay green.
