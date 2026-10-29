---
id: 01a184ff-5404-779c-a319-cd5d9aaf2a62
title: A browser serving root is a held terminal's retained cwd, not proof of the dev server's root
ord: 99
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/servedRoots.ts
---
The lookup uses the project's retained host-local listener evidence and reads only the associated terminal record; it starts no host scan. Missing or stale evidence, unresolved or conflicting listener ownership, and foreign environments yield no candidate. The terminal's launch cwd can differ from a child server's configured root, so the browser must verify each candidate file exists within a registered checkout before presenting it as source.