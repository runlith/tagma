---
id: 01a0cb2e-e785-7c09-bced-4538ac36ea12
title: The /model options list keeps a pinned model's plain twin standing under its second provider
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cb01-11ae-7e80-be80-b58a16fec8e4",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/harness/HarnessHost.account.svelte.test.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/View.svelte.ts
---
`HarnessHost.account.svelte.test.ts` fails: the flat `/model` options list shows `★ GPT-5.6 Sol` and a plain `GPT-5.6 Sol` (and would show `Opus 5` twice next). `gpt-5.6-sol` is offered under both `openai` (api-key) and `openai-oauth` since `PICKABLE_PROVIDERS` became every composed provider (c80aaa10dd), while the dedup at `HarnessHost.svelte.ts` compares `pinned.provider === group.provider && pinned.id === model.id` — it drops only the same-provider twin. The flat list's own contract is that a pinned model stands once on top: dedup on the model's identity. Done when the account suite is green.