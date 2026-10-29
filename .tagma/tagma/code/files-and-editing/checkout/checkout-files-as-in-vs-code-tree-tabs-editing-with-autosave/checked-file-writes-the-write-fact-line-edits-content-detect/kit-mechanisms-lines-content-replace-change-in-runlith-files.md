---
id: 01a117f1-a817-7178-929e-8a6247323f90
title: "Kit mechanisms: lines, content, replace, change in @runlith/files and ripgrep launch in @runlith/ripgrep"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a117dd-98e5-7df2-86cb-e3f5bcb8266a
---
Implements spec bcb8266a in three landings: (1) `packages/files/src/lines.ts`; (2) `contentOf` and `@runlith/ripgrep` `run.ts`; (3) moving the CAS write and write fact from agent-tools and `composition/lineWrites.ts` to the kit, moving five binary definitions to `contentOf`. Done when the spec acceptance passes, agent grep, glob, and read answer as before, and typecheck and tests of the touched packages are green.
