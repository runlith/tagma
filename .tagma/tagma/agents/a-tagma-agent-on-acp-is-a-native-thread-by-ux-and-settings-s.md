---
id: 01a14fe3-a2c2-7879-8087-db6be5eed6b8
title: "A Tagma agent on ACP is a native thread by UX and settings: same model, reasoning, row, chat and model settings"
ord: 84
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
edges:
  - kind: supersedes
    to: 01a14f72-057b-7960-a80c-4977af264e00
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/threads/native
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/protocol
  - kind: dir
    ref: apps/tagma/server/src/threads/contract/wire/harness
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/modelSettings.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/selection.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/model.ts
---
ACP for a Tagma agent is only a transport. A thread on it is born with a model and reasoning like a native one, through whichever door opened it, and its models stand in the regular model picker under their provider, not under the item where terminal CLIs live. Every model setting a native thread has exists and acts the same on ACP, with the same values and default; where the vendor does not accept one, it is a declared transport capability the thread's row names.