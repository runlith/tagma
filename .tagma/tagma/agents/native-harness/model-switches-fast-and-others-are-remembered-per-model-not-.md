---
id: 01a12290-5778-7136-b392-919d416cb6e8
title: Model switches (Fast and others) are remembered per model, not per provider or thread
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1228a-efcd-745e-8fdc-e3aa9f4403c1",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadSettings.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/preferences.ts
---
Operator: Fast on GPT had to be enabled anew in every thread, and when the model changed it moved over from the old one. Needed: enabled stays enabled, disabled stays disabled, and that value belongs to the model (Sol fast, Astra not).

Done: owner switch memory is stored by provider and model (`model_preference.default_switches`; a migration moves the old provider record onto the row's current model); `set_model_defaults` remembers any declared switch; a model change in a thread and in a draft takes the new model's memory, not the old model's values. The `remembered` flag is renamed to `inherited`: it now means only "a spawned child takes the value from its parent" — Fast is still not inherited by children.

Proof: `threadsDoor.itest.ts` (Fast is remembered for Sol and does not appear on Astra), `ThreadSettings.svelte.test.ts`, `ThreadSpawnBirth.test.ts`, typecheck of llm/agent/server/app.
