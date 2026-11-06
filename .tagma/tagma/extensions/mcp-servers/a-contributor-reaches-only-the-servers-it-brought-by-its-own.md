---
id: 01a1b2e7-4e9a-771a-bdbe-82f7dd557ae7
title: A contributor reaches only the servers it brought, by its own name for them, and a declaration that takes the name over refuses the call
ord: 18
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18917-0287-7c9f-a2fe-9906f2bc214d
sources:
  - kind: symbol
    ref: apps/tagma/server/src/mcp/declarations.ts
    symbol: mcpBrought
  - kind: file
    ref: apps/tagma/server/src/mcp/operations.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/contract/service/contributions.ts
---
`call_contributed_tool` takes the server by the name its contributor gives it (`McpContribution.local`), never by the pooled `<plugin>-<name>`, and looks it up among that contributor's own contributions only. So a plugin cannot reach a server another plugin brought, or one the person declared, by naming it. The contributor is the caller's own: a plugin process's `plugin` from admission, which already refused `plugin-not-enabled` outside the projects it runs in. Only an operator call takes `plugin` and `view` from the input, as the window's client sends them from the mount.

When a project or user declaration of the same pooled name stands, the name in the pool means that declaration, not the plugin's server. The call then refuses `mcp-server-shadowed` instead of calling it, because calling it would hand the plugin a server, and its sign-in, that the person declared for something else. A server switched off by `mcp.contributionsOff` refuses `mcp-server-unavailable` before the pool is touched. The pool is raised for that one server, as a view's request raises it, so the call starts none of the project's other servers.
