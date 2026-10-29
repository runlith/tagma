---
id: 01a12328-b68f-7184-958f-a307e6a6df6d
title: "The doctrine section declares its own place in the prompt, and composition gathers module operations from manifests: remove PROMPT_ORDER and the operation spreads in composition/catalog.ts"
ord: 117
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12328-d1fd-784b-b07b-bba5523a3be5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/catalog.ts
  - kind: file
    ref: apps/tagma/server/src/threads/doctrine/assemblies.ts
  - kind: file
    ref: apps/tagma/server/src/threads/doctrine/render.ts
---
Reviewing the plugins module (commit 8360718) showed: `PROMPT_ORDER` in `threads/doctrine/assemblies.ts` lists sections declared by other modules (`commit-steps`, `mcp-servers`, `plugins` …), and `doctrineText` (`render.ts`) rejects a section no assembly named — a new module must edit the `threads` list. Likewise `composition/catalog.ts` spreads `PLUGIN_OPERATIONS` by name, though the `plugins` manifest already declares `operations`; for sandbox, settings and native-harness such spreads are recorded in the merge list [[4a9013bf]] as transitional, for `PROMPT_ORDER` and plugins they are not. Violates [[edea5454]].

Goal: the section's place in the assembly is declared by the section itself in its module's manifest, composition sorts; composition takes each module's operations from its manifest. Section order in assembled prompts does not change.

Done when a new module adds a doctrine section and operations through its manifest alone, `PROMPT_ORDER` and per-module operation spreads are removed, and the doctrine assembly test shows the previous section order in every assembly.
