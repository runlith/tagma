---
id: 01a13c18-e04c-7b71-bc15-c609ef3b19d0
title: "A stored default model on a removed provider leaves no dead path: defaults, thread birth and favorites yield to a served model"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c0f-2a0a-7c90-bed3-d503f75a643f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/preference.ts
---
`read_model_defaults` refused `provider-not-installed`, the client stayed without `ModelDefaults.value` — model choice disappeared from the input, and thread birth refused with the same code: no new threads.

Do: a stored choice served by no installed adapter yields to the fresh-install default in `modelDefaults` and `birthModels.selection`; the stored ids stay. Favorites answer with servable pairs only, so editing favorites does not run into a departed model. A thread on a departed provider shows the model id in its picker and moves to an installed model.

Proof: `native-harness/modelDefaults.itest.ts` — defaults, the `read_model_defaults` door, birth, favorites and `set_thread_model` from a departed provider.
