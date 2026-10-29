---
id: 01a14b6d-b201-7441-9c04-0ef8664eb914
title: New thread is born on the operator's default model; favorite models stand first in the picker
ord: 13
---
A new thread whose birth names no model is born on the model, rung, switches, and account the operator picked by default. Favorite models stand first in the picker.

**How.** In the new-thread draft the model choice in the picker is remembered as the default model (if a thread can be born on it). The `read_model_defaults` / `set_model_defaults` operations (operator): `account: null` leaves the provider default account, a named account becomes it; switches are stored separately per model. Favorites — stars and dragging in the picker, the `read_model_favorites` / `set_model_favorites` operations.

**Limits.** A saved model served by no installed adapter yields to a fresh install's model — the first provider that has an account; the saved one stays and returns with the adapter. No providers at all — `no-provider`. A stale record revision — `stale-revision`.

Code: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts#MODEL_OPERATIONS, apps/tagma/app/src/lib/features/threads/birth/BirthSettings.svelte.ts, apps/tagma/app/src/lib/features/threads/ModelDefaults.svelte.ts, apps/tagma/app/src/lib/features/threads/Favorites.svelte.ts
