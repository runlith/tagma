---
id: 01a18816-519c-7c83-bdca-b98f197273fd
title: One key store `secrets` replaces plugin-secrets and resolves MCP `${NAME}` before the environment
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e4142a1788
---
Part 1 of [[142a1788]]: the `secrets` module on `@runlith/credential-file`; owner kinds registered by `mcp` and by today's apps module; `read_secrets`, `set_secret` and `remove_secret` replacing the three `*_plugin_secret` operations; the move of `plugin-secrets.json`; `${NAME}` resolved from the store, then the environment; `needs-value` rows; removing an owner drops its values. Done when the spec's Values, Migration and No-leaks acceptance pass.