---
id: 01a14c08-22b6-75de-88f8-5bfa3af9eb3d
title: The agent, at the operator's request, or the operator themselves installs a provider as an adapter package from npm, GitHub, or a directory, and updates it without restarting the server
ord: 13
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfbf3189649
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfc99c7336a
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/adapters/Section.svelte
  - kind: file
    ref: apps/tagma/server/src/composition/hostModules.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/external.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/fetch.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/installs.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/reads.ts
  - kind: file
    ref: apps/tagma/server/src/providers/cli/adapter.ts
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/capability.ts
  - kind: file
    ref: apps/tagma/server/src/providers/contract/wire/operations.ts
---
**Value.** A provider not built into Tagma can be connected with one request to an agent or one command, and a new adapter version needs no server restart and breaks no running threads.

**How.** A request to the Tagma agent "install the adapter …": the `install_adapter`, `update_adapter`, `disable_adapter`, `enable_adapter`, `remove_adapter` operations and the installed `read_adapters` read — its tools of the `adapters` capability; the Adapters section on the Providers screen (Add, Update, Disable or Enable, Remove); `tagma adapter add|update|disable|enable|remove`.

**Behaviour.** The agent installs, updates, enables, disables, and deletes an adapter without asking in trust and bypass modes, and in review mode each such call waits for the operator's confirmation. The source is an npm package with or without a version, a GitHub repository, or a local directory; Tagma fetches the package, installs its dependencies without peer dependencies, and remembers the source it then updates from. Each version installs into its own directory: a running run finishes on the version it started with, the new one serves from the next run, and login, credentials, and quota read it at once. The adapter executes in the server process and receives effect and contract modules from the server copy; import outside that list is an adapter-load refusal, so a server without the `--no-install` flag does not load external adapters. Disabling and deleting leave the providers' credentials ([[f3189649]]). Previous-version directories are removed at server startup.

**Limits.** An external adapter depends only on built-ins, not on another external one. There is no adapter catalog with search. The previous version holds memory until the server restarts. The adapter has no process of its own: an adapter's synchronous work stops the whole server, and not allowing that is the author's duty.
