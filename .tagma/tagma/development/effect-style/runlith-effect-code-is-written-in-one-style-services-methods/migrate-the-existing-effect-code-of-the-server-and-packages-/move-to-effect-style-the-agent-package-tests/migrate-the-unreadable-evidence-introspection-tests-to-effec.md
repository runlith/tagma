---
id: 01a14002-f132-7177-b9d7-aea92fbccedb
title: Migrate the unreadable-evidence introspection tests to Effect
ord: 24
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
    ref: packages/agent/src/thread/run/ThreadIntrospection.test.ts
---
Migrate ThreadIntrospection.test.ts to it.effect with no direct runner and no casts of ports. Keep the walk of the unreadable entry with evidence address/family and the typed persistence refusal on addressed reading; replace message copy with a type and call check, keeping the schema issue address as data. Full tagged doubles with fail-fast, change no production. Serial file test, package check, law, one Sol+Muse round; evidence to the parent before landing.
