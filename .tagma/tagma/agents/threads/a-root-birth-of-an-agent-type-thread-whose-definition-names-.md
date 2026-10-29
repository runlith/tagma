---
id: 01a1235c-228f-72a5-8af2-b9f53cde0f52
title: A root birth of an agent-type thread whose definition names a model is born on that model — as spawn already does
ord: 120
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-315a-7ac2-8df7-255b44e179d5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05f05ced9ad0
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/birth/acts.ts
  - kind: file
    ref: packages/agent/src/collaboration/modelChoice.ts
---
Poker acceptance showed: root `create_thread` with `type: 'poker.player-haiku'` ignores the `model:` from the agent definition's frontmatter — the thread born on the default owner's model (`thread.profile.overlay.model` carries haiku/low but unread). `profile.model` read only by the child spawn path (`modelChoice.ts`); root birth (`threads/birth/acts.ts`, `models.selection({account, switches})`) does not see it. `create_thread` takes no model, `set_thread_model` open to the operator only — the plugin cannot seat players on different models, though the stage-1 spec requires it.

Delivered: root and spawn use `profileModel` at the `packages/agent/src/collaboration/modelChoice.ts` owner. A type without a model keeps defaults. On provider change without a model or with `model: null`, the new provider's default chosen. An unserved profile model refuses `model-unserved` with unblock; the account checked at the chosen provider, remembered switches taken from one preferences snapshot. One Sol xhigh review gave two confirmed correctness defects plus a repeat read — all fixed without repeat review. Agent/server typecheck clean; 53 unit tests and 9 system tests pass. An HTTP check of the saved definition guards model, reasoning, account, remembered switches, fallback, provider-only and typed refusal. It stands in `.stest.ts` since it assembles the whole server; the file sample: 12035 ms CPU, 9920 ms wall at a 60000 ms wall system budget. The working server not restarted.
