---
id: 01a18a3f-6419-79a8-aee2-5f67bd1c8213
title: Preserve a trial installation's launch bindings and build home
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-8536-738c-b5e1-63f0aaf778ff",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a17d0b-0b3e-7b85-af47-64971ac32af8
  - kind: discovered-from
    to: 01a17d10-85eb-7f7d-8a69-65bed4498841
  - kind: discovered-from
    to: 01a17d12-8041-77ce-82b3-8cfbec7d7aa5
---
Keep a beside installation's launcher bound to its own data and ports across checkout builds, without rewriting the caller's shell profile. Carry the launching developer's build home separately from the trial server's isolated home so HEAD updates can find the existing Rust toolchain and signing keychain.