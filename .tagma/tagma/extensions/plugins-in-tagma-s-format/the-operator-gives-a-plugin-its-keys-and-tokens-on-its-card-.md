---
id: 01a14c08-8336-7b3c-965a-b09ad47a3359
title: The operator gives a plugin its keys and tokens on its card, and they reach its process without landing in the manifest or the feed
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/secrets
  - kind: dir
    ref: apps/tagma/server/src/secrets
  - kind: file
    ref: apps/tagma/server/src/plugins/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/enabled.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/PluginPage.svelte
---
**Value.** An API key or token a plugin needs is entered once by the operator on the plugin's card, and never lands in `tagma-plugin.json`, the graph or the feed.

**How.** The plugin declares options in its manifest, each named as the environment variable its process reads; one marked `sensitive` is a secret. The plugin's card in Plugins shows each option, whether it is set, and a field for a secret once the plugin runs in that project. A secret is kept in the one key store beside MCP servers' values, under the `plugins` owner and the plugin's id; `set_secret` and `remove_secret` are the operator's alone.

**Behaviour.**
- The value is handed to the process in env under the option's key; a new or removed value restarts the process once, repeating the same value does not.
- The value is never read back; everything the process answers over MCP — text, data, resources, tool descriptions, refusals, its stderr tail — is masked wherever it carries the value.
- A plain option is stored in the operator's `plugins.options` setting, which the card writes; its declared default stands while none is set, and a secret's default is never shown.

**Limits.** An option key cannot start with `TAGMA_` or name a variable every process starts with. What the process itself sends to Tagma over HTTP is not masked. Uninstalling drops the plugin's secret values.
