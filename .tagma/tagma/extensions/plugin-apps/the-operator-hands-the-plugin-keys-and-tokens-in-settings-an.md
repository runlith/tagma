---
id: 01a14c08-8336-7b3c-965a-b09ad47a3359
title: The operator hands the plugin keys and tokens in settings, and they reach its process without landing in the manifest or the feed
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
    ref: apps/tagma/app/src/lib/features/plugin-secrets
  - kind: dir
    ref: apps/tagma/server/src/plugin-secrets
---
**Value.** An API key or token the plugin needs is entered once by the operator in settings, and never lands in `plugin.json`, the graph, or the feed.

**How.** The plugin declares secrets at the `secrets` point — environment variable name and what to ask the operator. Settings → Plugins shows each plugin's fields, whether a value is set and how many are missing; below them `read_plugin_secrets`, `set_plugin_secret`, `remove_plugin_secret`, all operator-only.

**Behaviour.**
- The value is stored on the machine in an owner-only file and handed to the process in env under the secret's name; a new or removed value restarts the process once, repeating the same value does not.
- The value is never read back; everything the process answers over MCP — text, data, resources, tool descriptions, refusals — is masked wherever it carries the value.
- Fields appear after the first manifest read of an enabled plugin: a plugin that crashes without the secret still shows where to enter it.

**Limits.** The number of secrets per plugin is capped; `TAGMA_*` names and base process variables are banned. What the process itself sends to Tagma over HTTP is not masked. Values of a removed plugin stay in the file until removed.
