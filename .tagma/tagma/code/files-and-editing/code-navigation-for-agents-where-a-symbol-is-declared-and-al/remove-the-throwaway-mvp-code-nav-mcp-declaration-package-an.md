---
id: 01a16403-beb9-7ca6-8852-b686417d35b1
title: "Remove the throwaway MVP code-nav: MCP declaration, package, and its module card"
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16063-3d26-728c-a9fe-a15d601d54a5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Operator decision. The core replaced the MVP, while its MCP server on runlith still holds a second TypeScript engine (2.15 GB `tsc` footprint plus the bun process). Remove the MCP server declaration, delete `packages/code-nav` with its workspace references, the lockfile — via install — and the module card [[e1594033]].
