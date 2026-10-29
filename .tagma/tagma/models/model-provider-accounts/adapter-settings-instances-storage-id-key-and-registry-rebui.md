---
id: 01a12d55-dba2-7eba-9307-a572a6410e2a
title: "Adapter settings instances: storage, id, key and registry rebuild"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/instanceActs.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/instanceRows.ts
---
An adapter declaring `settings` (a field schema, `defineAdapter(provide, settings)`) receives instances in `host.instances` that the operator created on the Providers screen; each instance becomes a provider with the instance id. The `adapter_instance` table stores the values (adapter, id, JSON values), and they survive adapter removal.

- **An instance id is assigned at creation and never changes**: `<adapter>-<name slug>` with a numeric suffix on collision. Renaming changes only the name value, so threads, the default account and the key stay on the same provider.
- **The key is the instance provider's console key**, the same one the rest of the core shows and uses; the schema's `key` field never reaches the values. The key is written after the registry rebuild through `SignIns`, so the default account and quota see it; while the instance has no models there is no provider, and the key goes straight to the key store. Without a key the request leaves with no `Authorization`.
- **Every save rebuilds all adapters** (`registry.reload`), because instance providers are a function of their values; a run holds the catalog it started with. An instance with no enabled models declares no provider, and a model with no context window never reaches the store: `normalize` and `validate` refuse the adapter with `instance-invalid`.
- **The server model list is an action that stores nothing**: `discover_adapter_models` returns candidates, and only models the operator added to the instance reach the registry.
