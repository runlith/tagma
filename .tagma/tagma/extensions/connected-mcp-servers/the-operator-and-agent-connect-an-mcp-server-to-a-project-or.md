---
id: 01a14c08-8336-7b3c-965a-b0918f8891ff
title: The operator and agent connect an MCP server to a project or to all of the operator's projects, and enable, disable and remove it
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/mcp
  - kind: file
    ref: apps/tagma/server/src/mcp/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/declarations.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/operations.ts
  - kind: file
    ref: packages/mcp/src/McpServerDeclaration.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/signIns.ts
---
**Value.** An external tool — GitHub, a database, browser devtools — connects to Tagma agents as a standard MCP server, with no code in Tagma.

**How.** Settings → MCP servers (declaration form, server cards with state, toggle, removal) or the `add_mcp_server`, `enable_mcp_server`, `remove_mcp_server`, `read_mcp_servers` operations, which the agent has too; only the operator signs a server in and out (`sign_in_mcp_server`, `sign_out_mcp_server`). Declarations are stored by the `mcp.servers` setting, writable only by these operations.

**Behaviour.**
- A server is declared for a project or into the operator's personal set, for all projects; a project declaration with the same name overrides the personal one, and a project may refuse the whole personal set.
- A server starts by a stdio command or is reached over Streamable HTTP. A secret is written as a `${NAME}` reference and resolved at connect time from the value the operator set on the server's card, then from the Tagma server's environment; a server lacking one is still declared and reads `needs-value` naming it, and the value is masked in answers. Each project's server keeps its own values, and removing the server drops them.
- An HTTP server that answers with an OAuth challenge reads needs a sign-in. The operator signs in from its card: the service's page opens in the browser of the device in use, desktop or paired phone, and its answer returns to that door. Tagma keeps the tokens beside the server's values, refreshes them itself until the service refuses, then the card asks again; a client the operator registered with the service can be given instead of the one Tagma registers. The card follows the server's state live.
- The declaration names what the server's calls may demand of the host (permission kinds) and whether they change durable data — by default and per tool; the approval mode judges by that.
- In review mode, declaring and removing ask the operator; variables changing what the program will load (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS` and similar) raise a separate approval condition.
- Disabling keeps the declaration as written and stops the process; enabling brings back the same server. States: waiting, connecting, connected with tool count, needs a value, needs a sign-in, disabled, crashed with a reason.

**Limits and divergence.** The `env` field description of `add_mcp_server` says such variables are banned, while the code accepts them and only asks the operator in review. Tagma declarations are for Tagma's own agent; they do not change foreign CLIs' MCP configuration.
