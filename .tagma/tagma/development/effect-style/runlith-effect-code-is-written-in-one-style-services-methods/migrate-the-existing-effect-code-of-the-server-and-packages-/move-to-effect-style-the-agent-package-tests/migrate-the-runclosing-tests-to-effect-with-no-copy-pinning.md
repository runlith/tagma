---
id: 01a13ffa-900a-7adf-b68e-4708f38228cd
title: Migrate the runClosing tests to Effect with no copy-pinning
ord: 22
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
    ref: packages/agent/src/thread/run/runClosing.test.ts
---
Migrate runClosing.test.ts to it.effect: helpers return Effect, recorded entries are full with no casts. Check closing/state and mutation subjects instead of guidance text; keep once/read-only/re-entry/denied/already-reminded. Change no production. One serial test, package check in the permitted shape, law, one Sol+Muse round and evidence to the parent before landing.
