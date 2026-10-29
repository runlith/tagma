---
id: 01a18917-0287-7c9f-a2fe-9906f2bc214d
title: "A contributed MCP server is taken as written: no ${NAME} in it resolves, and a declaration of its name shadows it"
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/declarations.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/contract/service/contributions.ts
---
Contributed declarations (`McpContributions`, filled by the plugins module) arrive already final: their contributor expanded only its own format's variables. The pool therefore never resolves a `${…}` in them from the secret store or Tagma's environment and never reads them `needs-value`; whatever `${…}` is left goes to the server literally. Expanding them would let a package pull a value of the operator's environment into a header it sends to a host it chose. The values the contributor names in `redact` join the pool's redactor like resolved secrets.

They sit below the settings layers: a user or project declaration of the same name replaces one and reads `shadows: contributed`. A contributed server is no declaration, so `remove_mcp_server` refuses it `mcp-server-contributed`; `enable_mcp_server` with scope `contributed` writes its name into `mcp.contributionsOff`, a project setting keyed by name, so it stays off however often its contributor goes and comes back. A remote one signs in under its own record key `<project>/contributed/<name>`, apart from a project declaration of the same name. The pool settles open projects on the port's change stream; a pass that fails there is logged and the next change or thread turn settles again.