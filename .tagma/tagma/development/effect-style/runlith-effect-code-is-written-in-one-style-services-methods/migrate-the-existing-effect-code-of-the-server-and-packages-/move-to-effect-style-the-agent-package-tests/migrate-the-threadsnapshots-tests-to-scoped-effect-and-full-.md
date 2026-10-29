---
id: 01a14019-686a-7e3e-b210-8a81d6778a63
title: Migrate the ThreadSnapshots tests to scoped Effect and full ports
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.test.ts
---
Migrate ThreadSnapshots.test.ts to it.effect with full typed ports and memory rows/events/inbox. Keep the 9 durable cut/retry contracts, flush exactly once, publication order, life/ownership/questions, launch block, deadline-driven stall, bounded batch reads and attachments. Waits through Deferred/forkScoped and TestClock; remove partial casts, direct runners and timing sleeps. Change no production; use no storagePort factory/world. Serial file test, file-scoped typecheck with the parent's permission, law, one Sol+Muse round; diff/evidence to the parent before landing.
