---
id: 01a14c37-8e2d-7ede-b1e5-4af5f4522945
title: Remove the nonexistent loader-variable ban from the add_mcp_server description and rule 475a1eb0
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
The `env` field description of `add_mcp_server` says `PATH`, `LD_PRELOAD`, `NODE_OPTIONS` and the like are forbidden; the code accepts them and only asks in review (the `mcp-env-resolving` condition). Rule 475a1eb0 names the `mcpForbiddenEnvKeys` symbol, which does not exist. Under the agents-are-trusted rule 06e41b6f no ban is to be built — fix the description and the rule; anything else only on the operator's word.
