---
id: 01a184ff-5404-779c-a319-cd5d9aaf2a62
title: A browser serving root is a held terminal's retained cwd, not proof of the dev server's root
ord: 99
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/servedRoots.ts
---
The lookup uses the project's retained host-local listener evidence and reads only the associated terminal record; it starts no host scan. Missing or stale evidence, unresolved or conflicting listener ownership, and foreign environments yield no candidate. So does any gap in the report that could hide a TCP listener on the requested port: a gap naming that port, or a whole-scan gap naming none (refused, failed, timeout, truncated). A gap naming another port, or unsupported UDP, does not. On macOS a non-root reader sees only its own sockets, so the host attests the rest from the full socket table: it names each foreign listening port, and a foreign listener on the requested port refuses the candidate, since another user's socket can share the port on another address or family. The terminal's launch cwd can differ from a child server's configured root, so the browser must verify each candidate file exists within a registered checkout before presenting it as source.