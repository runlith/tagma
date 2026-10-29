---
id: 01a123bf-df38-77d4-bfc6-3cdb9b0f08f1
title: The plugins settings section in the app belongs to the plugins feature, and secret fields nest into it instead of registering a section themselves
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0d4647905f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12395-9b58-78c0-9bc7-fedd1f6db033
---
`plugin-secrets/settings.ts` registers a settings section with id `plugins`; if the `plugins` feature opens its own section with the same id, one is silently lost (`declared.ts` takes `find`). Done when the `plugins` section is declared by its owner, secrets nest their fields into it, and two registrations of one section id refuse naming both instead of losing one.
