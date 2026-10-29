---
id: 01a0d55b-2893-7236-ba24-b5a20f0a23ed
title: "Build `@tagma/inspection`: vocabulary door, the `direction` builtin, the judgement"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d571-d639-7548-b0a7-d71e6145e07e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d5e-79cd-95d5-c098982f1bca
  - kind: waits-on
    to: 01a0d55b-288e-764a-91b0-724667286c7c
sources:
  - kind: dir
    ref: apps/tagma/inspection
---
New package `apps/tagma/inspection` per [[ae56a980]]: a browser-safe vocabulary door (builtin ids, the `direction` parameter schema with `base`, `floors`, `siblings`, `reads`, `files`, and stated limitations) and a Node door with the implementation and the judgement — new fingerprints of the built side minus the base side, by fingerprint across the changed set, minus debt; unresolved relative specifiers as `unjudged`; the builtin's own refusal words. Pure: trees, rules and debt arrive as values. Done when its tests pin the judgement cases of [[f2755a5b]] that need no server, and its boundary test walks the vocabulary door as browser-safe.